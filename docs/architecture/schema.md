<!-- Fichier GÉNÉRÉ depuis une base PostgreSQL 16 migrée par les migrations de production (US-038, ADR-079) : ne pas modifier à la main. -->
<!-- Régénérer : job CI « base de données » (test:int, schema-doc) : copier le document imprimé, ou RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/db test:int sur un banc local. La CI échoue si ce fichier n'est plus à jour. -->

# Schéma de la base (production)

Lu dans le catalogue (`pg_catalog`) d'une base jetable du banc, après les seules migrations de `packages/db/migrations/` (sans les migrations de test), sous le rôle `app_api`. Fait foi pour l'état réel ; la cible est 17 §3 (écarts : `docs/team/PROPOSITIONS.md`).

## Synthèse

- 178 migrations ; 168 tables ; 6 vues ; 950 politiques RLS ; 428 fonctions `SECURITY DEFINER` ; 328 autres fonctions.
- Tables sans RLS `ENABLE` + `FORCE` : aucune.
- Rôles applicatifs avec `SUPERUSER` ou `BYPASSRLS` : aucun.

## Historique des migrations

| Migration | Objet |
| --------- | ----- |
| `0000_platform_now` | schéma `platform`, horloge de la base `platform.now()`, journal des migrations. |
| `0001_role_grants` | droits minimaux des rôles de production sur les objets de plateforme. |
| `0002_app_session_context` | schéma transverse `app` : lecture du contexte de session posé par la couche d'accès. |
| `0003_core_schema` | schéma unique de la Bêta pilote `core` et colonnes d'audit des tables mutables. |
| `0004_booking_occupancy_hold_trip` | AVL : occupations, holds de checkout, trips, compensations (schéma de preuve L0). |
| `0005_payment_operation_webhook_inbox` | PAY : opérations de paiement et boîte de réception des webhooks (schéma de preuve L0). |
| `0006_booking_disposition_invariants` | AVL : disposition des paiements (XOR) et invariants gardés par triggers. |
| `0007_avl_pay_worker_grants` | droits et politiques RLS des travailleurs (app_worker) sur les tables AVL et PAY. |
| `0008_config_country` | configuration pays (CFG) : devises, pays, paramètres versionnés, fériés, taxes par |
| `0009_config_seed` | graines de la configuration pays (US-013 ; 17 §7.2 ; ADR-024, ADR-033). |
| `0010_iam_identity` | IAM : comptes, vérification d'email, facteurs, sessions, OTP, comptes d'hôte, appartenances, |
| `0011_iam_auth_commands` | IAM : commandes de l'adaptateur interne du port d'authentification (comptes, sessions, |
| `0012_outbox_tables` | BUS : outbox transactionnelle, reçus de consommation, lettres mortes, tâches planifiées. |
| `0013_outbox_functions` | BUS : fonctions du relais, de la file et de la consommation idempotente. |
| `0014_outbox_grants` | BUS : droits et politiques RLS de l'outbox, de la file, des reçus et des lettres mortes. |
| `0015_outbox_monitoring` | BUS : métriques de l'outbox et des files (âge, profondeur, lettres mortes). |
| `0016_audit_subject_key` | AUD : clés de données par sujet (crypto-shredding) et garde des registres en ajout seul. |
| `0017_audit_log_chain` | AUD : journal d'audit en ajout seul, chaîné par hachage SHA-256. |
| `0018_audit_data_access_log` | AUD : journal d'accès aux données personnelles (ajout seul). |
| `0019_audit_file_asset` | AUD : métadonnées des fichiers (magasin de preuves) avec empreinte SHA-256 à la réception. |
| `0020_audit_subject_key_destruction` | AUD : procédure de destruction d'une clé de sujet (crypto-shredding), tracée. |
| `0021_audit_grants` | AUD : droits et politiques RLS des rôles de production sur les tables d'audit. |
| `0022_security_definer_owners` | propriétaires NOLOGIN dédiés des fonctions SECURITY DEFINER existantes. |
| `0023_avl_iam_foreign_keys` | clés étrangères AVL → IAM et cohérence pays du compte d'hôte. |
| `0024_app_context_policy_functions` | contexte de session complet, dossier de support (sous-ensemble) et fonctions de politique. |
| `0025_rls_actor_country_policies` | lectures d'app_api : politiques RLS par type d'acteur et par pays. |
| `0026_audit_owner_subject_key_scope` | AUD : propriétaire dédié du trigger de chaîne et cloisonnement des clés par sujet. |
| `0027_settlement_versions_legs` | STL : règlements persistés, versions, supersession et jambes. |
| `0028_payment_psp_port` | PAY : port PaymentProvider, comptes et capacités PSP, jambes, événements d'opération, |
| `0029_payment_pan_detector_layouts` | PAY : détecteur de PAN sans faux positif sur les identifiants structurés (UUID), en |
| `0030_ntf_notification_dispatch` | NTF : journal des envois de notifications (`notification_dispatch`). US-021 ; 17 §2.13, |
| `0031_iam_notification_contact` | IAM : coordonnées d'un destinataire de notification, pour le seul travailleur |
| `0032_booking_single_occupancy` | AVL : table d'occupation unique, blocages de l'hôte et tampons autonomes. |
| `0033_iam_staff_mfa` | IAM : authentification forte du staff (TOTP), sessions de staff liées à la MFA, |
| `0034_staff_console` | Console interne : matrice des permissions du staff, actions de console (`manual_action`), |
| `0035_host_permissions_minimization` | Rôle P2P_HOST : permissions de l'hôte, politiques RLS de l'hôte sur les jambes, |
| `0036_settlement_money_tables_finance` | Tables d'argent sans écriture directe, avances de Kmino, assureur, double validation |
| `0037_booking_hold_commands` | AVL : holds de checkout, commandes de pose et de libération, tâche d'expiration. |
| `0038_payment_outbox_tightening` | PAY et BUS : reports de sécurité confiés à US-023. |
| `0039_payment_marketplace_legs` | PAY / STL : port de place de marché (sous-marchands, capacités bloquantes) et écrivain des |
| `0040_booking_payment_intent` | AVL / PAY : intention de paiement (T1), affinage de l'ordre (T2), annulation d'ordre par la |
| `0041_booking_guarded_conversion` | AVL : conversion gardée, ré-acquisition, compensation, refus reçu, balayages. |
| `0042_config_brand` | CFG : socle de marque modifiable — versions de thème (`brand_version`), actifs de marque |
| `0043_config_brand_portuguese` | CFG : portugais du Brésil, quatrième langue des actifs et des blocs de contenu de marque. |
| `0044_config_country_portuguese` | graine complémentaire : langue « pt » ajoutée aux pays (locales et noms). |
| `0045_booking_production_oracle` | AVL : oracle de production C12 (lecture seule, alerte P1) et garde d'environnement de T1 |
| `0046_config_rate_limit_params` | graine complémentaire : paramètres « rate_limit_* » (US-052 ; 17 §7.2). |
| `0047_risk_rate_limit` | RISK : compteurs de débit partagés entre instances, plafond journalier de SMS par pays |
| `0048_security_env_guard_fail_closed` | Gardes d'environnement fail-closed sur NULL (C19) : PAY. |
| `0049_staff_read_access_outcome` | Console : issue d'accès des lectures du staff (403 au lieu d'une liste vide). |
| `0050_platform_environment_declaration` | Environnement de déploiement DÉCLARÉ (US-003, ADR-078 ; 17 §6.5 point 1, C19). |
| `0051_audit_staff_data_access_ops_monitor` | AUD : lectures de données personnelles par le staff journalisées ; supervision. |
| `0052_privacy_free_text_reasons` | Données personnelles : motifs libres fermés ou retirés des lectures applicatives. |
| `0053_iam_mfa_proof_key_rotation` | IAM : rotation SANS COUPURE de la clé de preuve d'élévation MFA du staff. |
| `0054_settlement_replay_leg_guards` | STL / PAY : correctifs de la red team argent de la porte du lot 0 (US-049). |
| `0055_payment_webhook_proof_guard` | PAY : une preuve WEBHOOK_SIGNED exige un webhook reçu, signé et rattaché (US-049, RC-5). |
| `0056_booking_vehicle_ownership_guards` | AVL : véhicule du compte exigé pour les blocages ; auto-réservation d'un membre refusée ; périodes bornées. |
| `0057_audit_worker_name_scope` | AUD : écritures et lecture des clés de sujet réservées aux travailleurs nommés. |
| `0058_payment_proof_hardening` | PAY : preuve d'un statut terminal durcie (quarantaine non effaçable, MANUAL_OPS, voie directe). |
| `0059_ctr_legal_consent` | CTR : gabarits juridiques versionnés et consentements (CGU, confidentialité, communications). |
| `0060_support_manual_action_framework` | SUP : cadre des actions de console (commande de domaine liée, aucun montant, pièces, FINANCE à deux personnes). |
| `0061_iam_host_account` | IAM : compte d'hôte d'une personne physique (titulaire, nom affiché), libre-service et action de console CREATE_HOST_ACCOUNT. |
| `0062_config_content_legal_keys` | CFG : blocs de contenu éditables, textes juridiques refusés et journalisés. |
| `0063_catalog_vehicle_reference` | CAT : catalogue de référence des véhicules (marques, modèles, variantes) et sa graine. |
| `0064_support_review_queue_profile_360` | SUP : files de revue avec délais, fiche 360°, notes internes, dossiers de support, pièces du staff, restrictions de compte. |
| `0065_config_otp_rate_params` | graine complémentaire : paramètres « otp_rate_* » (US-104 ; 17 §7.2). |
| `0066_iam_phone_otp` | IAM : vérification du téléphone par OTP (code à usage unique envoyé par SMS). |
| `0067_catalog_host_listings` | CAT : lieux de remise, véhicules et annonces de l'hôte (modèle bêta), clé étrangère du véhicule. |
| `0068_config_listing_photo_params` | graine complémentaire : paramètres « listing_min_photos* » (US-115 ; 17 §7.2). |
| `0069_config_listing_price_params` | graine complémentaire : paramètres « price_ceiling_* » (US-115 ; 17 §7.2). |
| `0070_ctr_host_terms` | CTR : CGU de l'hôte versionnées (`TOS_HOST`), acceptation horodatée et garde de la |
| `0071_catalog_host_calendar` | CAT / AVL : calendrier par véhicule, blocages de l'hôte par commande et préavis par lieu. |
| `0072_kyc_identity_verification` | KYC : vérification d'identité par parcours hébergé et consentement biométrique. |
| `0073_config_go_live_switch` | CFG : interrupteurs de mise en service par pays, changés seulement par deux personnes. |
| `0074_catalog_addition_requests` | CAT : file d'ajout au catalogue véhicules (demande de l'hôte, file de l'ops, rattachement de la variante). |
| `0075_kyc_host_verification` | KYC : inscription et vérification individuelle de l'hôte, filtrage des sanctions, profil |
| `0076_kyc_ops_decision` | KYC : décision de l'ops (KYC_DECISION), mise en file des revues manuelles, alerte de délai, dossier KYC complété. |
| `0077_catalog_vehicle_documents` | CAT : documents et éligibilité du véhicule (titre, prenda, plaque, châssis, inspection, âge), contestation de plaque. |
| `0078_config_vehicle_eligibility_params` | graine complémentaire : paramètres « elig_* » (US-124 ; 17 §7.2). |
| `0079_catalog_customs_import` | CAT : import des marques et modèles déclarés à la douane (suite d'US-113 ; ADR-109, |
| `0080_risk_self_booking_linked_accounts` | RISK / AVL : cumul hôte / voyageur, auto-réservation refusée y compris par un compte lié. |
| `0081_kyc_host_ops_verification` | KYC : vérification de l'hôte par l'ops PAR EXCEPTION (approbation automatique, filtrage |
| `0082_config_host_review_params` | graine complémentaire : paramètres « host_review_* » (US-108 ; 17 §7.2). |
| `0083_catalog_vehicle_chassis_formats` | CAT : numéro de châssis en deux formats (VIN ISO 3779 ou numéro non ISO) et historique des engagements de l'hôte. |
| `0084_catalog_listing_publication` | CAT : publication immédiate d'une annonce (comme Turo), retrait et revue de l'ops sur signal. |
| `0085_config_listing_review_params` | graine complémentaire : paramètres « listing_manual_review* » (US-118 ; 17 §7.2). |
| `0086_config_host_tax_id_params` | graine complémentaire : paramètres « host_tax_id_required_for_activation* » (US-123 ; 17 §7.2). |
| `0087_kyc_host_tax_id_optional` | KYC : numéro fiscal de l'hôte facultatif à l'activation (« jamais plus lourd que Turo »). |
| `0088_kyc_legal_name_match` | KYC : nom légal du compte rapproché du nom lu sur le permis, changement du nom légal. |
| `0089_config_privacy_params` | graine complémentaire : paramètres « privacy_* » (US-111 ; 17 §7.2). |
| `0090_audit_privacy_register` | AUD : registre Ley 81 (traitements, sous-traitants, règles de rétention), demandes des personnes, pseudonymisation des trips clos. |
| `0091_config_security_incident_params` | graine complémentaire : paramètres « security_incident_* » (US-112 ; 17 §7.2). |
| `0092_audit_security_incident` | AUD : registre des incidents de sécurité et des violations de données (délais de notification). |
| `0093_support_redteam_l1_fixes` | SUP / RISK / CAT : correctifs de la red team du lot 1 (séparation des tâches, auto-réservation, contestations, filtre de contact). |
| `0094_config_plate_claim_params` | graine complémentaire : paramètres « plate_claims_* » (US-122 ; 17 §7.2). |
| `0095_catalog_customs_shared` | CAT : catalogue de la douane partagé entre les pays (N-101, suite de l'import de la douane ; |
| `0096_catalog_customs_curation` | CAT : curation de l'import de la douane, lot 2 (N-101 ; ADR-123, ADR-109 §7 ; revue de |
| `0097_support_redteam_l1_pass2_fixes` | SUP / STL / RISK / KYC / AUD / BKG / CAT : correctifs de la passe n° 2 de la red team du lot 1. |
| `0098_config_upload_params` | graine complémentaire : paramètres « upload_* » (US-122 ; 17 §7.2). |
| `0099_booking_trip_state_machine` | AVL : machine à états du trip (SM-1, SM-1b), segment, conducteur principal, journal d'état. |
| `0100_pricing_quote` | PRC : devis figés, lignes et versions de prix du trip. |
| `0101_booking_host_trips_read` | AVL : lecture des trips de l'hôte (espace hôte, accueil A02 et réservations A05). |
| `0102_pricing_trip_fee` | PRC : trip fee du voyageur recalculé par la base dans le devis figé. |
| `0103_catalog_public_search` | CAT : recherche publique par zone, lieu de remise, dates et heures. |
| `0104_review_recorded_reviews` | REV : avis recueillis par l'ops, agrégats (note moyenne, nombre de trips) et note du voyageur. |
| `0105_catalog_search_cards` | CAT : cartes des résultats de la recherche publique (caution, instant du devis). |
| `0106_catalog_listing_page` | CAT : fiche du véhicule (S03) : galerie, contrôle des dates, lieu de remise exact. |
| `0107_config_quote_params` | graine complémentaire : paramètres « quote_* » (US-208 ; 17 §7.2). |
| `0108_booking_checkout` | AVL : checkout en une page, partie back-end (devis figé et pose du hold de checkout). |
| `0109_ctr_checkout_documents` | CTR : documents du checkout servis et publiables ; nom du conducteur comparé en NFC. |
| `0110_prc_protection_earnings_plans` | PRC / CAT / AVL : protections du voyageur et plans de gains de l'hôte, partie serveur. |
| `0111_config_protection_params` | graine complémentaire : paramètres « protection_* » (US-226 ; 17 §7.2). |
| `0112_booking_risk_checkout_controls` | AVL / RISK / KYC : contrôles bloquants du conducteur et revue des réservations signalées. |
| `0113_config_foreign_license_params` | graine complémentaire : paramètres « foreign_license_* » (US-209 ; 17 §7.2). |
| `0114_config_insurer_rc_params` | graine complémentaire : paramètres « insurer_rc_* » (US-205 ; 17 §7.2). |
| `0115_catalog_public_terms` | CAT / STL : conditions affichées sur la fiche et conditions du contrat de l'assureur. |
| `0116_payment_checkout_legs_proof` | PAY / AVL / PRC / STL : paiement par jambes au checkout, Kmino marchand de référence, |
| `0117_config_last_minute_window_params` | graine complémentaire : paramètres « last_minute_free_window* » (US-205 ; 17 §7.2). |
| `0118_prc_quote_mileage_checkout_terms` | PRC / CAT : distance figée dans le devis, conditions d'annulation du checkout, fenêtre |
| `0119_booking_flagged_review_decision` | AVL / RISK / SUP / KYC : décision de l'ops sur une réservation signalée, hold de revue |
| `0120_booking_checkout_review_state` | AVL : état de revue d'un hold de checkout, lu par le voyageur (S05). |
| `0121_settlement_refund_orders` | STL / PAY : ordres de remboursement et de jambe rattachés à la version du règlement, |
| `0122_ctr_rental_contract` | CTR / AVL : contrat de location hôte–voyageur par trip et signature horodatée (bêta). |
| `0123_settlement_refund_instances_advance` | PAY / STL : instance de remboursement (SM-8), avance de Kmino sur une jambe déjà versée, |
| `0124_booking_trip_cancellation_settled` | AVL / STL / SUP : annulations du voyageur, de l'hôte et de la plateforme déclenchées par |
| `0125_config_booking_request_mode_params` | graine complémentaire : paramètres « booking_request_mode* » (US-223 ; 17 §7.2). |
| `0126_booking_request_mode` | AVL / PAY : réservation sur demande (hold REQUEST), autorisation à l'envoi, capture par |
| `0127_payment_refund_scheduler` | PAY / STL : ordonnancement des remboursements planifiés et états SM-8 après l'envoi. |
| `0128_support_console_trip_cancellation` | SUP / AVL / STL : état d'une demande d'annulation lu par la console (O01). |
| `0129_settlement_host_ledger` | STL : grand livre minimal de l'hôte (`host_ledger`) ; pénalité d'annulation de l'hôte. |
| `0130_payment_refund_read` | PAY / AVL / SUP : lecture du remboursement par le voyageur, l'hôte et la console (S10). |
| `0131_payment_pan_detector_hex_digest` | PAY : le détecteur de PAN écarte les empreintes hexadécimales de 64 caractères (clé |
| `0132_support_console_self_guard_restriction_notices` | SUP / IAM / BKG : séparation des tâches sur les cinq entrées de la console restées hors de |
| `0133_booking_notification_parties` | AVL / NTF : parties d'une réservation lues par le travailleur des notifications. |
| `0134_config_vehicle_value_class_params` | graine complémentaire : paramètres « vehicle_default_value_class* » (US-113 ; 17 §7.2). |
| `0135_catalog_vehicle_value_class` | CAT : classe de valeur attribuée à la publication d'un véhicule non classé (BOARD N-83, |
| `0136_booking_guest_trips_read` | AVL : « Mis viajes » et détail du trip du voyageur (S08, S09), lecture seule. |
| `0137_finance_host_earnings_receipts` | FIN / AVL : reçu des gains de l'hôte, reçu du trip fee du voyageur, relevé mensuel des |
| `0138_booking_trip_constancia_read` | CTR / AVL : constancia d'arrendamiento d'un trip et recherche de l'hôte par plaque et date |
| `0139_settlement_host_ledger_advance_receivable` | STL : créance de l'hôte de la règle 3 bis portée au `host_ledger` (avance de Kmino). |
| `0140_booking_defaulted_host_trips_cancel` | AVL / SUP : hôte défaillant, annulation de ses trips à venir par l'ops, voyageurs remboursés |
| `0141_payment_refund_multi_tender` | PAY : remboursement réparti sur les moyens d'origine (TJ16c / TJ16d) et reprise après un |
| `0142_config_deposit_rail_params` | graine complémentaire : paramètres « deposit_always_required* » (US-225 ; 17 §7.2). |
| `0143_settlement_insurer_ledger` | STL / FIN : jambe de l'assureur — registre `insurer_ledger`, bordereau mensuel à double |
| `0144_booking_meeting_place` | AVL / CAT : lieux de prise et de retour (US-514 ; 19 US-514 ; 16 BKG-016 ; 08 BR-BOOK-09 ; |
| `0145_finance_receipt_alignment` | FIN : alignement des reçus et du relevé des gains sur les décisions écrites d'US-217 |
| `0146_payment_deposit_hold` | PAY : caution de la plateforme figée au checkout (`deposit_hold`), vue du voyageur sans |
| `0147_ctr_constancia_frozen_host_checkout_host` | CTR / AVL : hôte de la constancia lu du contrat FIGÉ ; hôte en prénom et initiale au |
| `0148_hardening_country_open` | SUP / FIN / CAT : durcissement avant l'ouverture d'un pays (suites des revues : BOARD |
| `0149_settlement_conversion_capture_legs` | STL / AVL / FIN : la capture prouvée d'un hold converti est rattachée au trip né de la |
| `0150_payment_deposit_decision` | PAY : décision de la caution à l'heure de décision (libération automatique, transitions |
| `0151_catalog_public_deposit_basis` | CAT : base de la caution annoncée AVANT le checkout (fiche S03, cartes S01 / S02). |
| `0152_payment_refund_lock_order_credit_collection` | PAY : durcissement argent n° 2 d'US-224 (suites des revues de #239, partie 224f : BOARD |
| `0153_payment_deposit_decision_before_opening` | PAY : décision de la caution, corrections « avant ouverture d'un pays » (US-702b). |
| `0154_catalog_request_mode_entry` | CAT : points d'entrée du mode sur demande (recherche, zones, fiche S03, devis S05). |
| `0155_redteam_l2_money_fixes` | Correctifs des constats de la red team argent du lot 2 (US-222d ; rapport |
| `0156_redteam_l2_rls_lb_fixes` | Correctifs de la red team RLS / ex-porte LB du lot 2 (US-222, partie 222d2 ; ADR-177). |
| `0157_config_param_change` | CFG : changement revu d'une valeur de paramètre pays, par deux personnes distinctes. |
| `0158_trip_inspection_photos` | TRP : photos guidées de l'état du véhicule, horodatage serveur et empreintes (bêta). |
| `0159_payout_payout_account` | PYO : compte de versement vérifié de l'hôte (`payout_account`). |
| `0160_config_payout_account_params` | graine complémentaire : paramètres « payout_account_rails* » (US-707 ; 17 §7.2). |
| `0161_messaging_trip_threads` | MSG : messagerie par trip entre le voyageur et l'hôte, masquage des coordonnées et |
| `0162_support_help_request` | SUP : demande d'aide pendant le trip (voyageur ou hôte), réponse automatique hors plage |
| `0163_trip_handover_in_person` | TRP / AVL : remise et retour du véhicule entre particuliers, en personne (bêta). |
| `0164_claim_evidence_bundle` | CLM : dossier de preuve d'un trip, manifeste scellé, export par l'ops (bêta). |
| `0165_payout_payout_batch` | PYO : lots de versement à l'hôte (SM-6) depuis la jambe HOST ; écrivain unique de |
| `0166_messaging_privacy_meetings_retention` | MSG : messagerie hôte–voyageur, confidentialité, rendez-vous et rétention. |
| `0167_settlement_host_ledger_chargebacks` | STL / PYO : grand livre de l'hôte complet (SM-6b), imputation des chargebacks perdus, |
| `0168_trip_overdue_detection` | TRP / AVL : détection automatique des retards, prolongation tacite de l'occupation et |
| `0169_payment_mit_post_trip_charges` | PAY : carte enregistrée (jeton du PSP), consentement MIT, débits post-trip conformes aux |
| `0170_review_double_blind` | REV : avis réciproques en double aveugle, publication simultanée, avis reçus. |
| `0171_trip_no_show_refusal` | AVL / STL / MSG / PAY : no-show et refus du véhicule déclarés par l'hôte, le voyageur ou |
| `0172_payout_claim_hold_host_payouts` | PYO : réclamation ouverte ⇒ versement retenu (`CLAIM`) ; lecture des versements par |
| `0173_trip_overdue_escalation` | TRP / SUP : escalade de non-restitution lancée par l'ops et vue des retards (bêta). |
| `0174_report_beta_views_reconciliation` | RPT / FIN : vues de la bêta (remises du jour, retards, KPI de sortie) et rapprochement |
| `0175_claim_damage_claims_decisions` | CLM : déclarations de dommage de l'hôte et d'incident du voyageur, décisions motivées par |
| `0176_trip_inspection_photo_fingerprint` | TRP : empreinte de photo d'état unique, tous trips, photos d'annonce comprises (bêta). |
| `0177_claim_incidental_invoices` | CLM : frais annexes demandés par l'hôte (facture SM-5), délai de réponse du voyageur |

## Rôles

| Rôle | LOGIN | SUPERUSER | BYPASSRLS | INHERIT | Membre de |
| ---- | ----- | --------- | --------- | ------- | --------- |
| `app_anon` | oui | non | non | oui | — |
| `app_api` | oui | non | non | oui | — |
| `app_worker` | oui | non | non | oui | — |
| `audit_chain_owner` | non | non | non | oui | — |
| `catalog_cmd_owner` | non | non | non | oui | — |
| `catalog_probe_owner` | non | non | non | oui | — |
| `cmd_golive_owner` | non | non | non | oui | — |
| `cmd_hold_owner` | non | non | non | oui | — |
| `cmd_money_owner` | non | non | non | oui | — |
| `cmd_param_owner` | non | non | non | oui | — |
| `guard_owner` | non | non | non | oui | — |
| `host_view_owner` | non | non | non | oui | — |
| `iam_auth_owner` | non | non | non | oui | — |
| `iam_staff_owner` | non | non | non | oui | — |
| `integrity_owner` | non | non | non | oui | — |
| `kyc_cmd_owner` | non | non | non | oui | — |
| `messaging_cmd_owner` | non | non | non | oui | — |
| `migrator` | oui | non | non | oui | audit_chain_owner (NOINHERIT), catalog_cmd_owner (NOINHERIT), catalog_probe_owner (NOINHERIT), cmd_golive_owner (NOINHERIT), cmd_hold_owner (NOINHERIT), cmd_money_owner (NOINHERIT), cmd_param_owner (NOINHERIT), guard_owner (NOINHERIT), host_view_owner (NOINHERIT), iam_auth_owner (NOINHERIT), iam_staff_owner (NOINHERIT), integrity_owner (NOINHERIT), kyc_cmd_owner (NOINHERIT), messaging_cmd_owner (NOINHERIT), policy_fn_owner (NOINHERIT), privacy_cmd_owner (NOINHERIT), review_cmd_owner (NOINHERIT), risk_limit_owner (NOINHERIT) |
| `policy_fn_owner` | non | non | non | oui | — |
| `privacy_cmd_owner` | non | non | non | oui | — |
| `review_cmd_owner` | non | non | non | oui | — |
| `risk_limit_owner` | non | non | non | oui | — |

## Schémas

| Schéma | Propriétaire | Droits |
| ------ | ------------ | ------ |
| `app` | `migrator` | app_api: USAGE ; app_worker: USAGE ; catalog_probe_owner: USAGE ; cmd_golive_owner: USAGE ; cmd_hold_owner: USAGE ; cmd_money_owner: USAGE ; cmd_param_owner: USAGE ; guard_owner: USAGE ; host_view_owner: USAGE ; migrator: CREATE, USAGE ; policy_fn_owner: USAGE |
| `core` | `migrator` | app_api: USAGE ; app_worker: USAGE ; audit_chain_owner: USAGE ; catalog_cmd_owner: USAGE ; catalog_probe_owner: USAGE ; cmd_golive_owner: USAGE ; cmd_hold_owner: USAGE ; cmd_money_owner: USAGE ; cmd_param_owner: USAGE ; guard_owner: USAGE ; host_view_owner: USAGE ; iam_auth_owner: USAGE ; iam_staff_owner: USAGE ; integrity_owner: USAGE ; kyc_cmd_owner: USAGE ; messaging_cmd_owner: USAGE ; migrator: CREATE, USAGE ; policy_fn_owner: USAGE ; privacy_cmd_owner: USAGE ; review_cmd_owner: USAGE ; risk_limit_owner: USAGE |
| `platform` | `migrator` | app_api: USAGE ; app_worker: USAGE ; audit_chain_owner: USAGE ; catalog_cmd_owner: USAGE ; catalog_probe_owner: USAGE ; cmd_golive_owner: USAGE ; cmd_hold_owner: USAGE ; cmd_money_owner: USAGE ; cmd_param_owner: USAGE ; guard_owner: USAGE ; host_view_owner: USAGE ; iam_auth_owner: USAGE ; iam_staff_owner: USAGE ; integrity_owner: USAGE ; kyc_cmd_owner: USAGE ; messaging_cmd_owner: USAGE ; migrator: CREATE, USAGE ; policy_fn_owner: USAGE ; privacy_cmd_owner: USAGE ; review_cmd_owner: USAGE ; risk_limit_owner: USAGE |

## Tables

### `core.audit_audit_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `bigint` | oui | — |
| `at` | `timestamp with time zone` | oui | — |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `action_code` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `before` | `jsonb` | non | — |
| `after` | `jsonb` | non | — |
| `reason` | `text` | non | — |
| `ip_enc` | `bytea` | non | — |
| `ip_key_subject_type` | `text` | non | — |
| `ip_key_subject_id` | `uuid` | non | — |
| `c2_withheld` | `boolean` | oui | `false` |
| `request_id` | `uuid` | non | — |
| `prev_hash` | `bytea` | oui | — |
| `hash` | `bytea` | oui | — |

Contraintes :

- `audit_log_action_code_format` : `CHECK (action_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_log_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_log_after_object` : `CHECK (jsonb_typeof(after) = 'object'::text)`
- `audit_log_before_object` : `CHECK (jsonb_typeof(before) = 'object'::text)`
- `audit_log_hash_size` : `CHECK (octet_length(hash) = 32)`
- `audit_log_ip_envelope` : `CHECK (octet_length(ip_enc) >= 29 AND SUBSTRING(ip_enc FROM 1 FOR 1) = decode('01'::text, 'hex'::text))`
- `audit_log_ip_key_complete` : `CHECK ((ip_enc IS NULL) = (ip_key_subject_type IS NULL) AND (ip_key_subject_type IS NULL) = (ip_key_subject_id IS NULL))`
- `audit_log_ip_key_fk` : `FOREIGN KEY (ip_key_subject_type, ip_key_subject_id) REFERENCES core.audit_subject_key(subject_type, subject_id)`
- `audit_log_ip_key_is_actor` : `CHECK (ip_key_subject_type IS NULL OR ip_key_subject_type = 'USER'::text AND ip_key_subject_id = actor_user_id)`
- `audit_log_pkey` : `PRIMARY KEY (id)`
- `audit_log_prev_hash_size` : `CHECK (octet_length(prev_hash) = 32)`
- `audit_log_reason_length` : `CHECK (char_length(reason) >= 1 AND char_length(reason) <= 1000)`
- `audit_log_subject_type_format` : `CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_log_withheld_has_no_ip` : `CHECK (NOT (c2_withheld AND ip_enc IS NOT NULL))`

Index :

- `audit_log_subject_idx` : `CREATE INDEX audit_log_subject_idx ON core.audit_audit_log USING btree (subject_type, subject_id)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `catalog_cmd_audit_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `(((action_code = ANY (ARRAY['LISTING_SUBMITTED'::text, 'LISTING_DELETED'::text])) AND (subject_type = 'LISTING'::text)) OR ((action_code = ANY (ARRAY['VEHICLE_DECLARATION_SAVED'::text, 'VEHICLE_DOCUMENT_RECEIVED'::text, 'VEHICLE_ELIGIBILITY_SUBMITTED'::text])) AND (subject_type = 'VEHICLE'::text)) OR ((action_code = 'VEHICLE_CLAIM_OPENED'::text) AND (subject_type = 'VEHICLE_CLAIM'::text)))`
- `catalog_cmd_publish_audit` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((action_code = ANY (ARRAY['LISTING_PUBLISHED'::text, 'LISTING_UNLISTED'::text, 'LISTING_REJECTED'::text])) AND (subject_type = 'LISTING'::text))`
- `cmd_golive_ins` (INSERT, PERMISSIVE, cmd_golive_owner) WITH CHECK `true`
- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_param_ins` (INSERT, PERMISSIVE, cmd_param_owner) WITH CHECK `true`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `iam_auth_host_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((action_code = 'HOST_ACCOUNT_OPENED'::text) AND (subject_type = 'ORGANIZATION'::text))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_audit_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((action_code = ANY (ARRAY['KYC_CONSENT_WITHDRAWN'::text, 'KYC_ERASURE_RECORDED'::text])) AND (subject_type = 'USER_ACCOUNT'::text))`
- `kyc_cmd_erasure_audit_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((action_code = 'KYC_ERASURE_RETRIED'::text) AND (subject_type = 'USER_ACCOUNT'::text))`
- `kyc_cmd_host_audit_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((action_code = ANY (ARRAY['HOST_VERIFICATION_SUBMITTED'::text, 'HOST_SANCTIONS_SCREENED'::text, 'HOST_TAX_PROFILE_SAVED'::text, 'HOST_VERIFICATION_DECIDED'::text, 'HOST_ACCOUNT_STATUS_CHANGED'::text, 'HOST_SCREENING_REVIEWED'::text])) AND (subject_type = 'ORGANIZATION'::text))`
- `kyc_cmd_name_audit_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((action_code = 'LEGAL_NAME_CHANGED'::text) AND (subject_type = 'USER_ACCOUNT'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['audit_chain_verifier'::text, 'booking_conversion'::text, 'booking_oracle'::text, 'bordereau'::text, 'bus_monitor'::text, 'disposition_sweeper'::text, 'evidence_ingest'::text, 'evidence_verifier'::text, 'hold_expiry'::text, 'ntf_dispatcher'::text, 'ntf_sender'::text, 'ops_monitor'::text, 'outbox_relay'::text, 'payment_command'::text, 'payment_intent_sweeper'::text, 'payout'::text, 'privacy_request'::text, 'reconciliation'::text, 'settlement'::text, 'trip_lifecycle'::text, 'webhook_ingest'::text])))`
- `worker_select_verifier` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'audit_chain_verifier'::text))`

Déclencheurs :

- `audit_log_append_only` : `CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON core.audit_audit_log FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('audit_log_append_only')`
- `audit_log_no_truncate` : `CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON core.audit_audit_log FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('audit_log_append_only')`
- `zz_audit_log_chain` : `CREATE TRIGGER zz_audit_log_chain BEFORE INSERT ON core.audit_audit_log FOR EACH ROW EXECUTE FUNCTION core.audit_log_chain()`

### `core.audit_chain_head`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `chain` | `text` | oui | — |
| `last_id` | `bigint` | oui | — |
| `last_hash` | `bytea` | oui | — |

Contraintes :

- `audit_chain_head_chain_valid` : `CHECK (chain = 'audit_log'::text)`
- `audit_chain_head_last_hash_size` : `CHECK (octet_length(last_hash) = 32)`
- `audit_chain_head_last_id_valid` : `CHECK (last_id >= 0)`
- `audit_chain_head_pkey` : `PRIMARY KEY (chain)`

Politiques RLS :

- `audit_chain_advance` (UPDATE, PERMISSIVE, audit_chain_owner) USING `(chain = 'audit_log'::text)` WITH CHECK `(chain = 'audit_log'::text)`
- `audit_chain_read` (SELECT, PERMISSIVE, audit_chain_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select_verifier` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'audit_chain_verifier'::text))`

Déclencheurs :

- `audit_chain_head_guard` : `CREATE TRIGGER audit_chain_head_guard BEFORE DELETE OR UPDATE ON core.audit_chain_head FOR EACH ROW EXECUTE FUNCTION core.audit_chain_head_guard()`
- `audit_chain_head_no_truncate` : `CREATE TRIGGER audit_chain_head_no_truncate BEFORE TRUNCATE ON core.audit_chain_head FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('audit_chain_head_guard')`

### `core.audit_data_access_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `field_or_file` | `text` | oui | — |
| `purpose` | `text` | oui | — |
| `access_kind` | `text` | oui | — |
| `case_ref` | `text` | non | — |
| `request_id` | `uuid` | non | — |

Contraintes :

- `data_access_log_access_kind_valid` : `CHECK (access_kind = ANY (ARRAY['READ_C3'::text, 'READ_C2_SUPPORT'::text, 'BULK_EXPORT'::text, 'BREAK_GLASS'::text]))`
- `data_access_log_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `data_access_log_case_ref_format` : `CHECK (case_ref ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)`
- `data_access_log_field_or_file_format` : `CHECK (field_or_file ~ '^[A-Za-z0-9_.:-]{1,160}$'::text)`
- `data_access_log_pkey` : `PRIMARY KEY (id)`
- `data_access_log_purpose_length` : `CHECK (char_length(purpose) >= 1 AND char_length(purpose) <= 500)`
- `data_access_log_subject_type_format` : `CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`

Index :

- `data_access_log_subject_idx` : `CREATE INDEX data_access_log_subject_idx ON core.audit_data_access_log USING btree (subject_type, subject_id)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `iam_staff_claim_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `(subject_type = 'VEHICLE_CLAIM'::text)`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['audit_chain_verifier'::text, 'booking_conversion'::text, 'booking_oracle'::text, 'bordereau'::text, 'bus_monitor'::text, 'disposition_sweeper'::text, 'evidence_ingest'::text, 'evidence_verifier'::text, 'hold_expiry'::text, 'ntf_dispatcher'::text, 'ntf_sender'::text, 'ops_monitor'::text, 'outbox_relay'::text, 'payment_command'::text, 'payment_intent_sweeper'::text, 'payout'::text, 'privacy_request'::text, 'reconciliation'::text, 'settlement'::text, 'trip_lifecycle'::text, 'webhook_ingest'::text])))`

Déclencheurs :

- `data_access_log_append_only` : `CREATE TRIGGER data_access_log_append_only BEFORE DELETE OR UPDATE ON core.audit_data_access_log FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('data_access_log_append_only')`
- `data_access_log_no_truncate` : `CREATE TRIGGER data_access_log_no_truncate BEFORE TRUNCATE ON core.audit_data_access_log FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('data_access_log_append_only')`

### `core.audit_data_subject_request`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; privacy_cmd_owner: INSERT, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `support_case_id` | `uuid` | oui | — |
| `user_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `status` | `text` | oui | — |
| `received_at` | `timestamp with time zone` | oui | — |
| `due_at` | `timestamp with time zone` | oui | — |
| `identity_verified_at` | `timestamp with time zone` | non | — |
| `closed_at` | `timestamp with time zone` | non | — |
| `handled_by` | `uuid` | oui | — |
| `updated_at` | `timestamp with time zone` | oui | — |
| `overdue_alerted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `audit_data_subject_request_case_unique` : `UNIQUE (support_case_id)`
- `audit_data_subject_request_closed` : `CHECK ((status = ANY (ARRAY['DONE'::text, 'REJECTED'::text])) = (closed_at IS NOT NULL))`
- `audit_data_subject_request_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `audit_data_subject_request_due` : `CHECK (due_at > received_at)`
- `audit_data_subject_request_handled_by_fkey` : `FOREIGN KEY (handled_by) REFERENCES core.iam_user_account(id)`
- `audit_data_subject_request_kind_valid` : `CHECK (kind = ANY (ARRAY['ACCESS'::text, 'RECTIFICATION'::text, 'DELETION'::text, 'OPPOSITION'::text, 'PORTABILITY'::text]))`
- `audit_data_subject_request_pkey` : `PRIMARY KEY (id)`
- `audit_data_subject_request_status_valid` : `CHECK (status = ANY (ARRAY['RECEIVED'::text, 'VERIFYING'::text, 'IN_PROGRESS'::text, 'BLOCKED_LEGAL_HOLD'::text, 'DONE'::text, 'REJECTED'::text]))`
- `audit_data_subject_request_support_case_id_fkey` : `FOREIGN KEY (support_case_id) REFERENCES core.support_support_case(id)`
- `audit_data_subject_request_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `audit_data_subject_request_verified` : `CHECK ((status = ANY (ARRAY['RECEIVED'::text, 'VERIFYING'::text, 'REJECTED'::text])) OR identity_verified_at IS NOT NULL)`

Index :

- `audit_data_subject_request_due_idx` : `CREATE INDEX audit_data_subject_request_due_idx ON core.audit_data_subject_request USING btree (due_at) WHERE (closed_at IS NULL)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_insert` (INSERT, PERMISSIVE, privacy_cmd_owner) WITH CHECK `(status = 'RECEIVED'::text)`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`
- `privacy_cmd_update` (UPDATE, PERMISSIVE, privacy_cmd_owner) USING `(closed_at IS NULL)` WITH CHECK `true`

### `core.audit_file_asset`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `bucket` | `text` | oui | — |
| `storage_key` | `text` | oui | — |
| `mime` | `text` | oui | — |
| `bytes` | `bigint` | oui | — |
| `sha256` | `bytea` | oui | — |
| `uploader_user_id` | `uuid` | non | — |
| `source` | `text` | oui | — |
| `device_captured_at` | `timestamp with time zone` | non | — |
| `server_received_at` | `timestamp with time zone` | oui | `platform.now()` |
| `classification` | `text` | oui | — |
| `retention_class` | `text` | oui | — |
| `enc_subject_type` | `text` | non | — |
| `enc_subject_id` | `uuid` | non | — |
| `legal_hold_until` | `timestamp with time zone` | non | — |
| `deleted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `file_asset_bucket_valid` : `CHECK (bucket = ANY (ARRAY['PUBLIC_LISTING'::text, 'PRIVATE_EVIDENCE'::text, 'KYC'::text, 'DOCUMENTS'::text, 'BRAND'::text]))`
- `file_asset_bytes_valid` : `CHECK (bytes >= 0)`
- `file_asset_classification_valid` : `CHECK (classification = ANY (ARRAY['C0'::text, 'C1'::text, 'C2'::text, 'C3'::text, 'C4'::text]))`
- `file_asset_enc_key_complete` : `CHECK ((enc_subject_type IS NULL) = (enc_subject_id IS NULL))`
- `file_asset_enc_key_fk` : `FOREIGN KEY (enc_subject_type, enc_subject_id) REFERENCES core.audit_subject_key(subject_type, subject_id)`
- `file_asset_mime_format` : `CHECK (mime ~ '^[a-z]+/[a-z0-9][a-z0-9.+-]{0,126}$'::text)`
- `file_asset_no_secret` : `CHECK (classification <> 'C4'::text)`
- `file_asset_personal_encrypted` : `CHECK ((classification <> ALL (ARRAY['C2'::text, 'C3'::text])) OR enc_subject_type IS NOT NULL)`
- `file_asset_pkey` : `PRIMARY KEY (id)`
- `file_asset_public_bucket` : `CHECK ((bucket <> ALL (ARRAY['PUBLIC_LISTING'::text, 'BRAND'::text])) OR classification = 'C0'::text AND enc_subject_type IS NULL)`
- `file_asset_retention_class_format` : `CHECK (retention_class ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `file_asset_sha256_size` : `CHECK (octet_length(sha256) = 32)`
- `file_asset_source_valid` : `CHECK (source = ANY (ARRAY['IN_APP_CAMERA'::text, 'STAFF_UPLOAD'::text, 'GENERATED'::text, 'PROVIDER'::text, 'HOST_UPLOAD'::text]))`
- `file_asset_storage_key_format` : `CHECK (storage_key ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$'::text AND char_length(storage_key) <= 512)`
- `file_asset_storage_unique` : `UNIQUE (bucket, storage_key)`

Index :

- `file_asset_enc_subject_idx` : `CREATE INDEX file_asset_enc_subject_idx ON core.audit_file_asset USING btree (enc_subject_type, enc_subject_id) WHERE (enc_subject_type IS NOT NULL)`
- `file_asset_listing_sha256_idx` : `CREATE INDEX file_asset_listing_sha256_idx ON core.audit_file_asset USING btree (sha256) WHERE (bucket = 'PUBLIC_LISTING'::text)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `catalog_cmd_doc_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((bucket = 'DOCUMENTS'::text) AND (classification = 'C2'::text) AND (source = 'HOST_UPLOAD'::text) AND (enc_subject_type = 'USER'::text) AND (enc_subject_id IS NOT NULL) AND (enc_subject_id = uploader_user_id) AND (retention_class = 'VEHICLE_DOCUMENT'::text) AND (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/heic'::text, 'application/pdf'::text])))`
- `catalog_cmd_photo_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((bucket = 'PUBLIC_LISTING'::text) AND (classification = 'C0'::text) AND (source = 'HOST_UPLOAD'::text) AND (enc_subject_type IS NULL) AND (retention_class = 'LISTING_PHOTO'::text) AND (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])))`
- `cmd_hold_evidence_export_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((bucket = 'PRIVATE_EVIDENCE'::text) AND (classification = 'C2'::text) AND (source = 'GENERATED'::text) AND (retention_class = 'EVIDENCE_EXPORT'::text) AND (mime = 'application/zip'::text) AND (enc_subject_type = 'USER'::text) AND (enc_subject_id IS NOT NULL) AND (enc_subject_id = uploader_user_id))`
- `cmd_hold_evidence_file_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(bucket = 'PRIVATE_EVIDENCE'::text)`
- `cmd_hold_incidental_asset_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((bucket = 'PRIVATE_EVIDENCE'::text) AND (classification = 'C2'::text) AND (source = 'HOST_UPLOAD'::text) AND (retention_class = 'TRIP_INSPECTION'::text) AND (enc_subject_type = 'USER'::text) AND (enc_subject_id IS NOT NULL) AND (enc_subject_id = uploader_user_id) AND (mime = ANY (ARRAY['image/jpeg'::text, 'image/webp'::text])))`
- `cmd_hold_inspection_file_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((bucket = 'PRIVATE_EVIDENCE'::text) AND (classification = 'C2'::text) AND (source = 'IN_APP_CAMERA'::text) AND (retention_class = 'TRIP_INSPECTION'::text) AND (enc_subject_type = 'USER'::text) AND (enc_subject_id IS NOT NULL) AND (enc_subject_id = uploader_user_id) AND (mime = ANY (ARRAY['image/jpeg'::text, 'image/webp'::text])))`
- `cmd_hold_inspection_listing_sha_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(bucket = 'PUBLIC_LISTING'::text)`
- `iam_staff_evidence_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((bucket = 'PRIVATE_EVIDENCE'::text) AND (classification = 'C2'::text) AND (source = 'STAFF_UPLOAD'::text) AND (enc_subject_type = 'USER'::text) AND (enc_subject_id IS NOT NULL) AND (retention_class = 'STAFF_EVIDENCE'::text))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((bucket = 'BRAND'::text) AND (classification = 'C0'::text) AND (source = 'STAFF_UPLOAD'::text) AND (enc_subject_type IS NULL) AND (retention_class = 'BRAND_PUBLIC'::text))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['audit_chain_verifier'::text, 'booking_conversion'::text, 'booking_oracle'::text, 'bordereau'::text, 'bus_monitor'::text, 'disposition_sweeper'::text, 'evidence_ingest'::text, 'evidence_verifier'::text, 'hold_expiry'::text, 'ntf_dispatcher'::text, 'ntf_sender'::text, 'ops_monitor'::text, 'outbox_relay'::text, 'payment_command'::text, 'payment_intent_sweeper'::text, 'payout'::text, 'privacy_request'::text, 'reconciliation'::text, 'settlement'::text, 'trip_lifecycle'::text, 'webhook_ingest'::text])))`
- `worker_select_verifier` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'evidence_verifier'::text))`

Déclencheurs :

- `file_asset_immutable` : `CREATE TRIGGER file_asset_immutable BEFORE DELETE OR UPDATE ON core.audit_file_asset FOR EACH ROW EXECUTE FUNCTION core.audit_file_asset_guard()`
- `file_asset_no_truncate` : `CREATE TRIGGER file_asset_no_truncate BEFORE TRUNCATE ON core.audit_file_asset FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('file_asset_immutable')`

### `core.audit_processing_activity`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `text` | oui | — |
| `legal_basis` | `text` | oui | — |
| `data_classes` | `text[]` | oui | — |
| `sensitive` | `boolean` | oui | — |
| `recipients` | `text[]` | oui | `'{}'::text[]` |
| `subprocessors` | `text[]` | oui | `'{}'::text[]` |
| `retention_rules` | `text[]` | oui | `'{}'::text[]` |
| `collected_in_beta` | `boolean` | oui | — |
| `story` | `text` | oui | — |

Contraintes :

- `audit_processing_activity_basis_valid` : `CHECK (legal_basis = ANY (ARRAY['CONSENT'::text, 'CONTRACT'::text, 'LEGAL_OBLIGATION'::text, 'LEGITIMATE_INTEREST'::text]))`
- `audit_processing_activity_classes_valid` : `CHECK (cardinality(data_classes) > 0 AND data_classes <@ ARRAY['C1'::text, 'C2'::text, 'C3'::text])`
- `audit_processing_activity_code_format` : `CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_processing_activity_pkey` : `PRIMARY KEY (code)`
- `audit_processing_activity_recipients_valid` : `CHECK (recipients <@ ARRAY['HOST'::text, 'GUEST'::text, 'INSURER'::text, 'PSP'::text, 'AUTHORITY'::text])`
- `audit_processing_activity_sensitive_consent` : `CHECK (NOT sensitive OR legal_basis = 'CONSENT'::text)`
- `audit_processing_activity_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.audit_retention_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; privacy_cmd_owner: INSERT, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `rule_code` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `action` | `text` | oui | — |
| `columns` | `text[]` | oui | — |
| `due_at` | `timestamp with time zone` | oui | — |
| `at` | `timestamp with time zone` | oui | — |

Contraintes :

- `audit_retention_log_action_valid` : `CHECK (action = ANY (ARRAY['PSEUDONYMISATION'::text, 'PURGE'::text]))`
- `audit_retention_log_after_due` : `CHECK (at >= due_at)`
- `audit_retention_log_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `audit_retention_log_once` : `UNIQUE (rule_code, subject_id)`
- `audit_retention_log_pkey` : `PRIMARY KEY (id)`
- `audit_retention_log_rule_code_fkey` : `FOREIGN KEY (rule_code) REFERENCES core.audit_retention_rule(code)`
- `audit_retention_log_subject_valid` : `CHECK (subject_type = 'TRIP'::text)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_insert` (INSERT, PERMISSIVE, privacy_cmd_owner) WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

Déclencheurs :

- `audit_retention_log_append_only` : `CREATE TRIGGER audit_retention_log_append_only BEFORE DELETE OR UPDATE ON core.audit_retention_log FOR EACH ROW EXECUTE FUNCTION core.privacy_append_only()`
- `audit_retention_log_no_truncate` : `CREATE TRIGGER audit_retention_log_no_truncate BEFORE TRUNCATE ON core.audit_retention_log FOR EACH STATEMENT EXECUTE FUNCTION core.privacy_append_only()`

### `core.audit_retention_rule`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; privacy_cmd_owner: SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `text` | oui | — |
| `param_key` | `text` | oui | — |
| `anchor` | `text` | oui | — |
| `action` | `text` | oui | — |
| `tables` | `text[]` | oui | — |
| `enforced_by` | `text` | oui | — |
| `story` | `text` | oui | — |

Contraintes :

- `audit_retention_rule_action_valid` : `CHECK (action = ANY (ARRAY['PSEUDONYMISATION'::text, 'PURGE'::text, 'CRYPTO_SHREDDING'::text, 'KEEP'::text]))`
- `audit_retention_rule_anchor_valid` : `CHECK (anchor = ANY (ARRAY['TRIP_LAST_ACTIVITY'::text, 'KYC_DECISION'::text, 'VEHICLE_LAST_TRIP'::text, 'EVENT'::text, 'RECEIVED'::text]))`
- `audit_retention_rule_code_format` : `CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_retention_rule_enforced_valid` : `CHECK (enforced_by ~ '^(MANUAL\|WORKER:[a-z][a-z0-9_]{1,62})$'::text)`
- `audit_retention_rule_param_key_fkey` : `FOREIGN KEY (param_key) REFERENCES core.config_param_definition(key)`
- `audit_retention_rule_pkey` : `PRIMARY KEY (code)`
- `audit_retention_rule_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`
- `audit_retention_rule_tables_format` : `CHECK (cardinality(tables) > 0 AND array_to_string(tables, ','::text) ~ '^(core\.[a-z][a-z0-9_]*)(,core\.[a-z][a-z0-9_]*)*$'::text)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

### `core.audit_security_incident`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `kind` | `text` | oui | — |
| `severity` | `text` | oui | — |
| `personal_data_involved` | `boolean` | non | — |
| `subjects_count_estimate` | `integer` | non | — |
| `detected_at` | `timestamp with time zone` | oui | — |
| `reported_at` | `timestamp with time zone` | oui | — |
| `reported_by` | `uuid` | oui | — |
| `authority_notification_due_at` | `timestamp with time zone` | oui | — |
| `subjects_notification_due_at` | `timestamp with time zone` | oui | — |
| `contained_at` | `timestamp with time zone` | non | — |
| `authority_notified_at` | `timestamp with time zone` | non | — |
| `subjects_notified_at` | `timestamp with time zone` | non | — |
| `closed_at` | `timestamp with time zone` | non | — |
| `status` | `text` | oui | — |
| `postmortem_file_id` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | — |
| `updated_by` | `uuid` | oui | — |
| `opened_alerted_at` | `timestamp with time zone` | non | — |
| `authority_overdue_alerted_at` | `timestamp with time zone` | non | — |
| `subjects_overdue_alerted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `audit_security_incident_closed` : `CHECK ((status = 'CLOSED'::text) = (closed_at IS NOT NULL) AND (closed_at IS NULL OR postmortem_file_id IS NOT NULL AND contained_at IS NOT NULL))`
- `audit_security_incident_closed_notified` : `CHECK (closed_at IS NULL OR personal_data_involved IS FALSE OR authority_notified_at IS NOT NULL AND subjects_notified_at IS NOT NULL)`
- `audit_security_incident_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `audit_security_incident_detected` : `CHECK (detected_at <= reported_at)`
- `audit_security_incident_due` : `CHECK (authority_notification_due_at >= detected_at AND subjects_notification_due_at >= detected_at)`
- `audit_security_incident_kind_valid` : `CHECK (kind = ANY (ARRAY['DATA_BREACH'::text, 'CREDENTIAL_LEAK'::text, 'PSP_CREDENTIAL_COMPROMISE'::text, 'AVAILABILITY'::text, 'OTHER'::text]))`
- `audit_security_incident_pkey` : `PRIMARY KEY (id)`
- `audit_security_incident_postmortem_file_id_fkey` : `FOREIGN KEY (postmortem_file_id) REFERENCES core.audit_file_asset(id)`
- `audit_security_incident_reported_by_fkey` : `FOREIGN KEY (reported_by) REFERENCES core.iam_user_account(id)`
- `audit_security_incident_severity_valid` : `CHECK (severity = ANY (ARRAY['CRITICAL'::text, 'HIGH'::text, 'MEDIUM'::text, 'LOW'::text]))`
- `audit_security_incident_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'CONTAINED'::text, 'NOTIFIED'::text, 'CLOSED'::text]))`
- `audit_security_incident_subjects_valid` : `CHECK (subjects_count_estimate IS NULL OR subjects_count_estimate >= 0)`
- `audit_security_incident_updated_by_fkey` : `FOREIGN KEY (updated_by) REFERENCES core.iam_user_account(id)`

Index :

- `audit_security_incident_open_idx` : `CREATE INDEX audit_security_incident_open_idx ON core.audit_security_incident USING btree (country_code) WHERE (closed_at IS NULL)`

Politiques RLS :

- `iam_staff_incident_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((status = 'OPEN'::text) AND (closed_at IS NULL) AND (contained_at IS NULL) AND (authority_notified_at IS NULL) AND (subjects_notified_at IS NULL) AND (opened_alerted_at IS NULL))`
- `iam_staff_incident_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_incident_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `audit_security_incident_guard` : `CREATE TRIGGER audit_security_incident_guard BEFORE DELETE OR UPDATE ON core.audit_security_incident FOR EACH ROW EXECUTE FUNCTION core.security_incident_guard()`
- `audit_security_incident_no_truncate` : `CREATE TRIGGER audit_security_incident_no_truncate BEFORE TRUNCATE ON core.audit_security_incident FOR EACH STATEMENT EXECUTE FUNCTION core.security_incident_guard()`

### `core.audit_subject_key`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `wrapped_dek` | `bytea` | non | — |
| `kms_key_id` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `destroyed_at` | `timestamp with time zone` | non | — |
| `destroy_request_id` | `uuid` | non | — |

Contraintes :

- `subject_key_destroy_has_request` : `CHECK (destroyed_at IS NULL OR destroy_request_id IS NOT NULL)`
- `subject_key_destroyed_has_no_dek` : `CHECK ((destroyed_at IS NULL) = (wrapped_dek IS NOT NULL))`
- `subject_key_kms_key_id_format` : `CHECK (kms_key_id ~ '^[A-Za-z0-9:/_.+=-]{1,255}$'::text)`
- `subject_key_pkey` : `PRIMARY KEY (subject_type, subject_id)`
- `subject_key_type_valid` : `CHECK (subject_type = ANY (ARRAY['USER'::text, 'ORG'::text, 'PLATFORM'::text]))`
- `subject_key_wrapped_dek_size` : `CHECK (octet_length(wrapped_dek) >= 32 AND octet_length(wrapped_dek) <= 1024)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (((subject_type = 'USER'::text) AND (subject_id = app.actor_id())) OR ((subject_type = 'ORG'::text) AND (subject_id = app.org_id()) AND app.is_org_holder())))`
- `api_select` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (((subject_type = 'USER'::text) AND (subject_id = app.actor_id())) OR ((subject_type = 'ORG'::text) AND (subject_id = app.org_id()) AND app.is_org_holder())))`
- `audit_chain_lock` (UPDATE, PERMISSIVE, audit_chain_owner) USING `true` WITH CHECK `false`
- `audit_chain_read` (SELECT, PERMISSIVE, audit_chain_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['evidence_ingest'::text, 'privacy_request'::text])))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['evidence_ingest'::text, 'evidence_verifier'::text, 'privacy_request'::text])))`

Déclencheurs :

- `subject_key_immutable` : `CREATE TRIGGER subject_key_immutable BEFORE DELETE OR UPDATE ON core.audit_subject_key FOR EACH ROW EXECUTE FUNCTION core.audit_subject_key_guard()`
- `subject_key_no_truncate` : `CREATE TRIGGER subject_key_no_truncate BEFORE TRUNCATE ON core.audit_subject_key FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('subject_key_immutable')`

### `core.audit_subprocessor`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; privacy_cmd_owner: SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `text` | oui | — |
| `service` | `text` | oui | — |
| `name` | `text` | oui | — |
| `mode` | `text` | oui | — |
| `processing_countries` | `text[]` | oui | `'{}'::text[]` |
| `data_classes` | `text[]` | oui | — |
| `contract_ref` | `text` | non | — |
| `transfer_safeguard` | `text` | non | — |
| `retention_terms` | `text` | non | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `valid_to` | `timestamp with time zone` | non | — |
| `story` | `text` | oui | — |

Contraintes :

- `audit_subprocessor_classes_valid` : `CHECK (cardinality(data_classes) > 0 AND data_classes <@ ARRAY['C1'::text, 'C2'::text, 'C3'::text])`
- `audit_subprocessor_code_format` : `CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `audit_subprocessor_contract_length` : `CHECK (contract_ref IS NULL OR char_length(contract_ref) >= 3 AND char_length(contract_ref) <= 200)`
- `audit_subprocessor_contracted` : `CHECK (mode <> 'CONTRACTED'::text OR contract_ref IS NOT NULL AND transfer_safeguard IS NOT NULL)`
- `audit_subprocessor_countries_format` : `CHECK (array_to_string(processing_countries, ','::text) ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'::text)`
- `audit_subprocessor_mode_valid` : `CHECK (mode = ANY (ARRAY['SIMULATED'::text, 'SELF_HOSTED'::text, 'PLANNED'::text, 'CONTRACTED'::text]))`
- `audit_subprocessor_name_length` : `CHECK (char_length(name) >= 2 AND char_length(name) <= 120)`
- `audit_subprocessor_period` : `CHECK (valid_to IS NULL OR valid_to > valid_from)`
- `audit_subprocessor_pkey` : `PRIMARY KEY (code)`
- `audit_subprocessor_retention_length` : `CHECK (retention_terms IS NULL OR char_length(retention_terms) >= 3 AND char_length(retention_terms) <= 500)`
- `audit_subprocessor_safeguard_valid` : `CHECK (transfer_safeguard IS NULL OR (transfer_safeguard = ANY (ARRAY['NONE_REQUIRED'::text, 'CONSENT'::text, 'CONTRACTUAL_CLAUSES'::text, 'ADEQUATE_COUNTRY'::text])))`
- `audit_subprocessor_service_valid` : `CHECK (service = ANY (ARRAY['KYC'::text, 'HOSTING'::text, 'EMAIL'::text, 'SMS'::text, 'WHATSAPP_BSP'::text, 'OBSERVABILITY'::text, 'PSP'::text, 'ANTIVIRUS'::text, 'MAP_TILES'::text]))`
- `audit_subprocessor_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

### `core.booking_checkout_acceptance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `hold_id` | `uuid` | oui | — |
| `quote_id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `manual_confirmed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `booking_checkout_acceptance_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `booking_checkout_acceptance_guest_user_id_fkey` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `booking_checkout_acceptance_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `booking_checkout_acceptance_pkey` : `PRIMARY KEY (hold_id)`
- `booking_checkout_acceptance_quote_id_fkey` : `FOREIGN KEY (quote_id) REFERENCES core.pricing_quote(id)`
- `booking_checkout_acceptance_quote_unique` : `UNIQUE (quote_id)`

Politiques RLS :

- `cmd_hold_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `true`
- `cmd_hold_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_checkout_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `booking_checkout_acceptance_guard` : `CREATE TRIGGER booking_checkout_acceptance_guard BEFORE DELETE OR UPDATE ON core.booking_checkout_acceptance FOR EACH ROW EXECUTE FUNCTION core.booking_checkout_record_guard()`
- `booking_checkout_acceptance_no_truncate` : `CREATE TRIGGER booking_checkout_acceptance_no_truncate BEFORE TRUNCATE ON core.booking_checkout_acceptance FOR EACH STATEMENT EXECUTE FUNCTION core.booking_checkout_record_guard()`

### `core.booking_checkout_hold`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `quote_id` | `uuid` | non | — |
| `occupancy_id` | `uuid` | oui | — |
| `kind` | `text` | oui | `'CHECKOUT'::text` |
| `status` | `text` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `payment_in_flight_until` | `timestamp with time zone` | non | — |
| `payment_attempts` | `integer` | oui | `0` |
| `expired_at` | `timestamp with time zone` | non | — |
| `release_requested_at` | `timestamp with time zone` | non | — |
| `released_at` | `timestamp with time zone` | non | — |
| `released_by` | `uuid` | non | — |
| `release_reason` | `text` | non | — |
| `review_required` | `boolean` | oui | `false` |
| `reviewed_at` | `timestamp with time zone` | non | — |
| `last_polled_at` | `timestamp with time zone` | non | — |
| `converted_trip_id` | `uuid` | non | — |
| `conversion_operation_id` | `uuid` | non | — |
| `compensated_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `request_respond_by` | `timestamp with time zone` | non | — |

Contraintes :

- `booking_checkout_hold_occupancy_id_fkey` : `FOREIGN KEY (occupancy_id) REFERENCES core.booking_vehicle_occupancy(id)`
- `booking_checkout_hold_pkey` : `PRIMARY KEY (id)`
- `checkout_hold_catalog_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`
- `checkout_hold_conversion_operation_fk` : `FOREIGN KEY (conversion_operation_id) REFERENCES core.payment_payment_operation(id)`
- `checkout_hold_converted_trip_fk` : `FOREIGN KEY (converted_trip_id) REFERENCES core.booking_trip(id)`
- `checkout_hold_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `checkout_hold_occupancy_party_fk` : `FOREIGN KEY (occupancy_id, vehicle_id, org_id, country_code) REFERENCES core.booking_vehicle_occupancy(id, vehicle_id, org_id, country_code)`
- `checkout_hold_occupancy_unique` : `UNIQUE (occupancy_id)`
- `checkout_hold_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `hold_awaiting_host_request` : `CHECK (status <> 'AWAITING_HOST'::text OR kind = 'REQUEST'::text AND request_respond_by IS NOT NULL)`
- `hold_conversion_matches_disposition` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `hold_conversion_op_unique` : `UNIQUE (conversion_operation_id)`
- `hold_converted_has_trip` : `CHECK (status <> 'CONVERTED'::text OR converted_trip_id IS NOT NULL AND conversion_operation_id IS NOT NULL)`
- `hold_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `hold_kind_valid` : `CHECK (kind = ANY (ARRAY['CHECKOUT'::text, 'REQUEST'::text]))`
- `hold_payment_attempts_nonnegative` : `CHECK (payment_attempts >= 0)`
- `hold_release_reason_valid` : `CHECK (release_reason = ANY (ARRAY['GUEST_ABANDON'::text, 'PAYMENT_DECLINED'::text, 'SUPERSEDED_BY_PAID_HOLD'::text, 'REVIEW_REJECTED'::text, 'HOST_UNAVAILABLE'::text, 'REQUEST_DECLINED'::text, 'CAPTURE_UNCONFIRMED'::text]))`
- `hold_request_respond_by_kind` : `CHECK (kind = 'REQUEST'::text OR request_respond_by IS NULL)`
- `hold_review_before_payment` : `CHECK (NOT review_required OR reviewed_at IS NOT NULL OR (status = ANY (ARRAY['ACTIVE'::text, 'EXPIRED'::text, 'RELEASED'::text])))`
- `hold_status_valid` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'AWAITING_HOST'::text, 'PAYMENT_IN_FLIGHT'::text, 'CONVERTED'::text, 'EXPIRED'::text, 'RELEASED'::text, 'COMPENSATED'::text]))`

Index :

- `checkout_hold_guest_status_idx` : `CREATE INDEX checkout_hold_guest_status_idx ON core.booking_checkout_hold USING btree (guest_user_id, status)`
- `checkout_hold_org_idx` : `CREATE INDEX checkout_hold_org_idx ON core.booking_checkout_hold USING btree (org_id)`
- `checkout_hold_vehicle_status_idx` : `CREATE INDEX checkout_hold_vehicle_status_idx ON core.booking_checkout_hold USING btree (vehicle_id, status)`
- `one_live_hold_per_guest_vehicle` : `CREATE UNIQUE INDEX one_live_hold_per_guest_vehicle ON core.booking_checkout_hold USING btree (guest_user_id, vehicle_id) WHERE (status = ANY (ARRAY['ACTIVE'::text, 'AWAITING_HOST'::text, 'PAYMENT_IN_FLIGHT'::text]))`

Politiques RLS :

- `cmd_hold_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()) AND (kind = 'CHECKOUT'::text) AND (status = 'ACTIVE'::text) AND ((org_id, country_code) = ( SELECT p.org_id, p.country_code FROM core.booking_vehicle_party(booking_checkout_hold.vehicle_id) p(org_id, country_code))))`
- `cmd_hold_request_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()) AND (kind = 'REQUEST'::text) AND (status = 'ACTIVE'::text) AND (request_respond_by IS NULL) AND ((org_id, country_code) = ( SELECT p.org_id, p.country_code FROM core.booking_vehicle_party(booking_checkout_hold.vehicle_id) p(org_id, country_code))))`
- `cmd_hold_request_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'REQUEST'::text) AND (((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (status = 'AWAITING_HOST'::text)) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND ((status = 'AWAITING_HOST'::text) OR ((status = 'PAYMENT_IN_FLIGHT'::text) AND (request_respond_by IS NOT NULL)))) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'booking_conversion'::text) AND (status = 'PAYMENT_IN_FLIGHT'::text))))` WITH CHECK `((kind = 'REQUEST'::text) AND (((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (status = ANY (ARRAY['PAYMENT_IN_FLIGHT'::text, 'RELEASED'::text]))) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (status = ANY (ARRAY['EXPIRED'::text, 'RELEASED'::text]))) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'booking_conversion'::text) AND (status = ANY (ARRAY['AWAITING_HOST'::text, 'RELEASED'::text])))))`
- `cmd_hold_review_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `(status = 'ACTIVE'::text)` WITH CHECK `(((status = 'ACTIVE'::text) AND review_required AND (reviewed_at IS NOT NULL)) OR ((status = 'RELEASED'::text) AND (release_reason = 'REVIEW_REJECTED'::text)))`
- `cmd_hold_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'GUEST'::text) AND (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text])))` WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text, 'EXPIRED'::text, 'RELEASED'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `guard_read` (SELECT, PERMISSIVE, guard_owner) USING `true`
- `hold_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))`
- `hold_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR ((converted_trip_id IS NOT NULL) AND app.staff_case_covers('TRIP'::text, converted_trip_id))))`
- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'booking_oracle'::text])))`
- `worker_update_conversion` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`
- `worker_update_expiry` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (status = ANY (ARRAY['EXPIRED'::text, 'RELEASED'::text])))`

Déclencheurs :

- `hold_conversion_matches_disposition` : `CREATE CONSTRAINT TRIGGER hold_conversion_matches_disposition AFTER INSERT OR UPDATE OF status, converted_trip_id, conversion_operation_id ON core.booking_checkout_hold DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.booking_assert_conversion_disposition()`
- `hold_guarded_columns` : `CREATE TRIGGER hold_guarded_columns BEFORE UPDATE ON core.booking_checkout_hold FOR EACH ROW EXECUTE FUNCTION core.booking_hold_guarded_columns()`
- `hold_review_item_close` : `CREATE TRIGGER hold_review_item_close AFTER UPDATE OF status ON core.booking_checkout_hold FOR EACH ROW WHEN ((old.status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text])) AND (new.status = ANY (ARRAY['EXPIRED'::text, 'RELEASED'::text, 'COMPENSATED'::text]))) EXECUTE FUNCTION core.booking_hold_review_item_close()`
- `hold_review_lapse` : `CREATE TRIGGER hold_review_lapse BEFORE UPDATE OF status ON core.booking_checkout_hold FOR EACH ROW WHEN (old.review_required AND old.reviewed_at IS NULL AND old.status = 'ACTIVE'::text AND new.status = 'EXPIRED'::text) EXECUTE FUNCTION core.booking_hold_review_lapse()`
- `hold_terminal_status` : `CREATE TRIGGER hold_terminal_status BEFORE UPDATE ON core.booking_checkout_hold FOR EACH ROW WHEN (old.status = ANY (ARRAY['CONVERTED'::text, 'COMPENSATED'::text])) EXECUTE FUNCTION core.booking_hold_terminal_guard()`
- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_checkout_hold FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_checkout_hold FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_checkout_terms`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `hold_id` | `uuid` | oui | — |
| `doc_kind` | `text` | oui | — |
| `template_id` | `uuid` | oui | — |
| `doc_version` | `integer` | oui | — |
| `locale` | `text` | oui | — |
| `consent_id` | `uuid` | oui | — |

Contraintes :

- `booking_checkout_terms_consent_id_fkey` : `FOREIGN KEY (consent_id) REFERENCES core.contract_consent(id)`
- `booking_checkout_terms_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_acceptance(hold_id)`
- `booking_checkout_terms_kind_valid` : `CHECK (doc_kind = ANY (ARRAY['TOS_GUEST'::text, 'CANCELLATION_POLICY'::text, 'GEO_TERMS'::text]))`
- `booking_checkout_terms_locale_valid` : `CHECK (locale = ANY (ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `booking_checkout_terms_pkey` : `PRIMARY KEY (hold_id, doc_kind)`
- `booking_checkout_terms_template_id_fkey` : `FOREIGN KEY (template_id) REFERENCES core.contract_document_template(id)`
- `booking_checkout_terms_version_positive` : `CHECK (doc_version >= 1)`

Politiques RLS :

- `cmd_hold_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `true`
- `cmd_hold_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `booking_checkout_terms_guard` : `CREATE TRIGGER booking_checkout_terms_guard BEFORE DELETE OR UPDATE ON core.booking_checkout_terms FOR EACH ROW EXECUTE FUNCTION core.booking_checkout_record_guard()`
- `booking_checkout_terms_no_truncate` : `CREATE TRIGGER booking_checkout_terms_no_truncate BEFORE TRUNCATE ON core.booking_checkout_terms FOR EACH STATEMENT EXECUTE FUNCTION core.booking_checkout_record_guard()`

### `core.booking_disposition_repair_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `attempts` | `integer` | oui | — |
| `first_failed_at` | `timestamp with time zone` | oui | — |
| `last_attempt_at` | `timestamp with time zone` | oui | — |
| `last_error` | `text` | oui | — |
| `alerted_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_disposition_repair_log_pkey` : `PRIMARY KEY (operation_id)`
- `disposition_repair_attempts_positive` : `CHECK (attempts >= 1)`
- `disposition_repair_error_format` : `CHECK (last_error ~ '^[0-9A-Z]{5}(:[a-z0-9_]{1,63})?$'::text)`
- `disposition_repair_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_sweeper` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))`
- `worker_update_sweeper` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_disposition_repair_log FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_guest_occupancy`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `period` | `tstzrange` | oui | — |
| `active` | `boolean` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_guest_occupancy_pkey` : `PRIMARY KEY (id)`
- `booking_guest_occupancy_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `guest_no_overlap` : `EXCLUDE USING gist (guest_user_id WITH =, period WITH &&) WHERE (active)`
- `guest_occupancy_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `guest_occupancy_trip_unique` : `UNIQUE (trip_id)`
- `period_valid` : `CHECK (period IS NOT NULL AND NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period) AND lower_inc(period) AND NOT upper_inc(period))`

Politiques RLS :

- `cmd_trip_guest_occ_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_trip_guest_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `(active AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((NOT active) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `cmd_trip_handover_guest_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `(active AND (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE ((t.id = booking_guest_occupancy.trip_id) AND (t.status = 'RETURNED'::text) AND (((app.actor_kind() = 'HOST'::text) AND (t.org_id = app.org_id())) OR ((app.actor_kind() = 'GUEST'::text) AND (t.guest_user_id = app.actor_id())))))))` WITH CHECK `((NOT active) AND (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE ((t.id = booking_guest_occupancy.trip_id) AND (t.status = 'RETURNED'::text) AND (((app.actor_kind() = 'HOST'::text) AND (t.org_id = app.org_id())) OR ((app.actor_kind() = 'GUEST'::text) AND (t.guest_user_id = app.actor_id())))))))`
- `guard_read` (SELECT, PERMISSIVE, guard_owner) USING `true`
- `guest_occupancy_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND active)`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'trip_lifecycle'::text])))`
- `worker_update_trip` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_guest_occupancy FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_hold_compensation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `hold_id` | `uuid` | oui | — |
| `reason` | `text` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `action` | `text` | oui | — |
| `refund_instance_id` | `uuid` | non | — |
| `status` | `text` | oui | `'OPEN'::text` |
| `opened_at` | `timestamp with time zone` | oui | `platform.now()` |
| `closed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_hold_compensation_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `booking_hold_compensation_pkey` : `PRIMARY KEY (id)`
- `hold_compensation_action_valid` : `CHECK (action = ANY (ARRAY['VOID'::text, 'LET_EXPIRE'::text, 'REFUND_API'::text, 'BANK_TRANSFER_REFUND'::text, 'OPS_LOOKUP'::text]))`
- `hold_compensation_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `hold_compensation_operation_unique` : `UNIQUE (operation_id)`
- `hold_compensation_reason_valid` : `CHECK (reason = ANY (ARRAY['SLOT_LOST_AFTER_EXPIRY'::text, 'SLOT_LOST_AFTER_RELEASE'::text, 'GUEST_OVERLAP'::text, 'INVARIANT_VIOLATION'::text, 'DUPLICATE_PAYMENT'::text, 'LATE_PAYMENT_AFTER_COMPENSATION'::text, 'ELIGIBILITY_CHANGED'::text, 'START_PASSED'::text, 'ORPHAN_PAYMENT'::text]))`
- `hold_compensation_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'EXECUTING'::text, 'DONE'::text, 'ESCALATED'::text]))`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (status = 'OPEN'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_hold_compensation FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_hold_compensation FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_payment_disposition`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `hold_id` | `uuid` | oui | — |
| `disposition` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `hold_compensation_id` | `uuid` | non | — |
| `decided_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `booking_payment_disposition_hold_compensation_id_fkey` : `FOREIGN KEY (hold_compensation_id) REFERENCES core.booking_hold_compensation(id)`
- `booking_payment_disposition_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `booking_payment_disposition_operation_id_fkey` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `booking_payment_disposition_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `disposition_compensation_has_ref` : `CHECK ((disposition = 'COMPENSATION'::text) = (hold_compensation_id IS NOT NULL))`
- `disposition_conversion_has_trip` : `CHECK ((disposition = 'CONVERSION'::text) = (trip_id IS NOT NULL))`
- `disposition_matches_hold` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `payment_disposition_pkey` : `PRIMARY KEY (operation_id)`
- `payment_disposition_valid` : `CHECK (disposition = ANY (ARRAY['CONVERSION'::text, 'COMPENSATION'::text]))`

Index :

- `one_conversion_per_hold` : `CREATE UNIQUE INDEX one_conversion_per_hold ON core.booking_payment_disposition USING btree (hold_id) WHERE (disposition = 'CONVERSION'::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'booking_oracle'::text])))`

Déclencheurs :

- `disposition_matches_hold` : `CREATE CONSTRAINT TRIGGER disposition_matches_hold AFTER INSERT ON core.booking_payment_disposition DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.booking_assert_conversion_disposition()`
- `disposition_rent_payment_only` : `CREATE TRIGGER disposition_rent_payment_only BEFORE INSERT ON core.booking_payment_disposition FOR EACH ROW EXECUTE FUNCTION core.booking_assert_rent_payment_operation()`
- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_payment_disposition FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`

### `core.booking_trip`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `public_ref` | `text` | non | — |
| `guest_user_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `listing_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `timezone` | `text` | oui | — |
| `scheduled_start` | `timestamp with time zone` | oui | — |
| `scheduled_end` | `timestamp with time zone` | oui | — |
| `booked_at` | `timestamp with time zone` | oui | `platform.now()` |
| `status` | `text` | oui | — |
| `requirements_status` | `text` | oui | `'NONE'::text` |
| `payment_status` | `text` | oui | `'CONFIRMED'::text` |
| `source_hold_id` | `uuid` | non | — |
| `termination_reason` | `text` | non | — |
| `cancellation_reason` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `no_show_at` | `timestamp with time zone` | non | — |
| `checkin_validated_at` | `timestamp with time zone` | non | — |
| `cancel_initiator` | `text` | non | — |
| `cancel_requested_at` | `timestamp with time zone` | non | — |
| `at_risk_reason` | `text` | non | — |

Contraintes :

- `booking_trip_pkey` : `PRIMARY KEY (id)`
- `booking_trip_source_hold_id_fkey` : `FOREIGN KEY (source_hold_id) REFERENCES core.booking_checkout_hold(id)`
- `trip_at_risk_reason_valid` : `CHECK (at_risk_reason IS NULL OR at_risk_reason = 'PREVIOUS_OVERDUE'::text)`
- `trip_cancel_initiator_valid` : `CHECK (cancel_initiator IS NULL OR (cancel_initiator = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'CO_HOST'::text, 'PLATFORM'::text, 'SYSTEM'::text])))`
- `trip_cancellation_reason_code` : `CHECK (cancellation_reason IS NULL OR cancellation_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `trip_catalog_listing_fk` : `FOREIGN KEY (listing_id) REFERENCES core.catalog_listing(id)`
- `trip_catalog_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`
- `trip_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `trip_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `trip_has_active_occupancy` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `trip_id_country_unique` : `UNIQUE (id, country_code)`
- `trip_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `trip_payment_status_valid` : `CHECK (payment_status = ANY (ARRAY['CONFIRMED'::text, 'REFUNDED_PARTIAL'::text, 'REFUNDED'::text]))`
- `trip_period_valid` : `CHECK (scheduled_start < scheduled_end)`
- `trip_public_ref_unique` : `UNIQUE (public_ref)`
- `trip_requirements_status_valid` : `CHECK (requirements_status = ANY (ARRAY['NONE'::text, 'PENDING'::text, 'SATISFIED'::text, 'FAILED'::text]))`
- `trip_source_hold_unique` : `UNIQUE (source_hold_id)`
- `trip_status_valid` : `CHECK (status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text, 'RETURNED'::text, 'UNRETURNED'::text, 'TERMINATED_EARLY'::text, 'VEHICLE_LOST'::text, 'POST_TRIP'::text, 'COMPLETED'::text, 'IN_DISPUTE'::text, 'CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text]))`
- `trip_terminated_has_reason` : `CHECK (status <> 'TERMINATED_EARLY'::text OR termination_reason IS NOT NULL)`
- `trip_termination_reason_code` : `CHECK (termination_reason IS NULL OR termination_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`

Index :

- `trip_guest_idx` : `CREATE INDEX trip_guest_idx ON core.booking_trip USING btree (guest_user_id)`
- `trip_org_vehicle_idx` : `CREATE INDEX trip_org_vehicle_idx ON core.booking_trip USING btree (org_id, vehicle_id)`

Politiques RLS :

- `catalog_cmd_guest_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text]))`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_trip_handover_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text])) AND (((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id())) OR ((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))))` WITH CHECK `((status = ANY (ARRAY['CHECKIN_OPEN'::text, 'IN_PROGRESS'::text, 'RETURNED'::text])) AND (((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id())) OR ((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))))`
- `cmd_trip_overdue_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((status = ANY (ARRAY['IN_PROGRESS'::text, 'OVERDUE'::text, 'BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text])) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))` WITH CHECK `(((status = 'OVERDUE'::text) OR ((status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text])) AND (at_risk_reason = 'PREVIOUS_OVERDUE'::text))) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))`
- `cmd_trip_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `money_lock` (UPDATE, PERMISSIVE, cmd_money_owner) USING `true` WITH CHECK `false`
- `money_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `privacy_cmd_pseudonymise` (UPDATE, PERMISSIVE, privacy_cmd_owner) USING `(status = ANY (ARRAY['COMPLETED'::text, 'CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text]))` WITH CHECK `(((termination_reason IS NULL) OR (termination_reason = 'PSEUDONYMISED'::text)) AND ((cancellation_reason IS NULL) OR (cancellation_reason = 'PSEUDONYMISED'::text)))`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`
- `review_cmd_read` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`
- `trip_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))`
- `trip_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND app.host_covers_vehicle(vehicle_id))`
- `trip_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR app.staff_case_covers('TRIP'::text, id)))`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (status = 'BOOKED'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'trip_lifecycle'::text, 'booking_oracle'::text])))`
- `worker_update_trip` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_trip FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`
- `trip_birth_defaults` : `CREATE TRIGGER trip_birth_defaults BEFORE INSERT ON core.booking_trip FOR EACH ROW EXECUTE FUNCTION core.booking_trip_birth_defaults()`
- `trip_birth_records` : `CREATE TRIGGER trip_birth_records AFTER INSERT ON core.booking_trip FOR EACH ROW EXECUTE FUNCTION core.booking_trip_birth_records()`
- `trip_has_active_occupancy` : `CREATE CONSTRAINT TRIGGER trip_has_active_occupancy AFTER INSERT OR UPDATE OF status, vehicle_id, scheduled_start, scheduled_end ON core.booking_trip DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.booking_assert_trip_occupancy('trip_has_active_occupancy')`
- `trip_period_sync` : `CREATE TRIGGER trip_period_sync AFTER UPDATE OF scheduled_start, scheduled_end ON core.booking_trip FOR EACH ROW WHEN (old.scheduled_start IS DISTINCT FROM new.scheduled_start OR old.scheduled_end IS DISTINCT FROM new.scheduled_end) EXECUTE FUNCTION core.booking_trip_period_sync()`
- `trip_transition_guard` : `CREATE TRIGGER trip_transition_guard BEFORE UPDATE OF status ON core.booking_trip FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION core.booking_trip_transition_guard()`

### `core.booking_trip_cancellation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `action_code` | `text` | oui | — |
| `requested_reason` | `text` | oui | — |
| `initiator` | `text` | oui | — |
| `sub_reason` | `text` | non | — |
| `requested_at` | `timestamp with time zone` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `settlement_id` | `uuid` | non | — |
| `cost_bearer` | `text` | non | — |
| `outcome_code` | `text` | non | — |
| `decided_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `host_message_traced` | `boolean` | non | — |
| `review_alerted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `trip_cancellation_action_valid` : `CHECK (action_code = ANY (ARRAY['CANCEL_TRIP_GUEST'::text, 'CANCEL_TRIP_HOST'::text, 'CANCEL_TRIP_PLATFORM'::text, 'DECLARE_NO_SHOW'::text, 'REFUSE_AT_PICKUP'::text, 'HOST_DECLARE_NO_SHOW'::text, 'GUEST_REPORT_HOST_NO_SHOW'::text]))`
- `trip_cancellation_cost_bearer_valid` : `CHECK (cost_bearer IS NULL OR (cost_bearer = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'PLATFORM'::text])))`
- `trip_cancellation_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_cancellation_outcome_format` : `CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `trip_cancellation_pkey` : `PRIMARY KEY (id)`
- `trip_cancellation_reason_valid` : `CHECK (action_code = 'CANCEL_TRIP_GUEST'::text AND initiator = 'GUEST'::text AND requested_reason = 'GUEST_CANCELLED'::text AND sub_reason IS NULL OR action_code = 'CANCEL_TRIP_HOST'::text AND initiator = 'HOST'::text AND (requested_reason = 'HOST_CANCELLED'::text AND sub_reason IS NULL OR requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'::text AND (sub_reason = ANY (ARRAY['INVALID_LICENSE'::text, 'IDENTITY_NOT_VERIFIED'::text, 'OTHER_DRIVER_SENT'::text, 'LICENSE_NOT_UPLOADED_1H'::text]))) OR action_code = 'CANCEL_TRIP_PLATFORM'::text AND initiator = 'PLATFORM'::text AND sub_reason IS NULL AND (requested_reason = ANY (ARRAY['PLATFORM_TRUST_SAFETY'::text, 'PLATFORM_INCOMPLETE_STEPS'::text, 'GUEST_FRAUD_PROVEN'::text, 'HOST_ACCOUNT_CLOSED'::text, 'PLATFORM_REVIEW_DELAY'::text, 'PSP_FAILURE'::text])) OR action_code = 'DECLARE_NO_SHOW'::text AND initiator = 'PLATFORM'::text AND sub_reason IS NULL AND (requested_reason = ANY (ARRAY['GUEST_NO_SHOW'::text, 'HOST_NO_SHOW'::text])) OR action_code = 'REFUSE_AT_PICKUP'::text AND (initiator = 'GUEST'::text AND requested_reason = 'CLEANLINESS_SAFETY_VALID'::text AND (sub_reason = ANY (ARRAY['CLEANLINESS'::text, 'SAFETY'::text])) OR initiator = 'HOST'::text AND requested_reason = 'HOST_CANCELLED_DUE_TO_GUEST'::text AND (sub_reason = ANY (ARRAY['INVALID_LICENSE'::text, 'IDENTITY_NOT_VERIFIED'::text, 'OTHER_DRIVER_SENT'::text]))) OR action_code = 'HOST_DECLARE_NO_SHOW'::text AND initiator = 'HOST'::text AND requested_reason = 'GUEST_NO_SHOW'::text AND sub_reason IS NULL OR action_code = 'GUEST_REPORT_HOST_NO_SHOW'::text AND initiator = 'GUEST'::text AND requested_reason = 'HOST_NO_SHOW'::text AND sub_reason IS NULL)`
- `trip_cancellation_refunded` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `trip_cancellation_review_alert_shape` : `CHECK (review_alerted_at IS NULL OR action_code = 'GUEST_REPORT_HOST_NO_SHOW'::text)`
- `trip_cancellation_review_shape` : `CHECK (status <> 'AWAITING_REVIEW'::text OR action_code = 'GUEST_REPORT_HOST_NO_SHOW'::text)`
- `trip_cancellation_settlement_fkey` : `FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement(id)`
- `trip_cancellation_status_shape` : `CHECK ((status = 'SETTLED'::text) = (settlement_id IS NOT NULL) AND (status = 'SETTLED'::text) = (cost_bearer IS NOT NULL) AND (status = ANY (ARRAY['FIN_REVIEW'::text, 'FAILED'::text])) = (outcome_code IS NOT NULL) AND (status = ANY (ARRAY['AWAITING_REVIEW'::text, 'PENDING'::text])) = (decided_at IS NULL))`
- `trip_cancellation_status_valid` : `CHECK (status = ANY (ARRAY['AWAITING_REVIEW'::text, 'PENDING'::text, 'SETTLED'::text, 'FIN_REVIEW'::text, 'FAILED'::text]))`
- `trip_cancellation_traced_shape` : `CHECK ((requested_reason = 'GUEST_NO_SHOW'::text) = (host_message_traced IS NOT NULL))`
- `trip_cancellation_trip_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Index :

- `trip_cancellation_live_unique` : `CREATE UNIQUE INDEX trip_cancellation_live_unique ON core.booking_trip_cancellation USING btree (trip_id) WHERE (status = ANY (ARRAY['PENDING'::text, 'SETTLED'::text, 'FIN_REVIEW'::text]))`
- `trip_cancellation_pending_idx` : `CREATE INDEX trip_cancellation_pending_idx ON core.booking_trip_cancellation USING btree (requested_at) WHERE (status = 'PENDING'::text)`
- `trip_cancellation_review_unique` : `CREATE UNIQUE INDEX trip_cancellation_review_unique ON core.booking_trip_cancellation USING btree (trip_id) WHERE (status = 'AWAITING_REVIEW'::text)`
- `trip_cancellation_settlement_unique` : `CREATE UNIQUE INDEX trip_cancellation_settlement_unique ON core.booking_trip_cancellation USING btree (settlement_id) WHERE (settlement_id IS NOT NULL)`

Politiques RLS :

- `cmd_hold_cancel_alert_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((status = 'AWAITING_REVIEW'::text) AND (review_alerted_at IS NULL) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((status = 'AWAITING_REVIEW'::text) AND (review_alerted_at IS NOT NULL) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `cmd_hold_cancel_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (requested_by = app.actor_id()))`
- `cmd_hold_cancel_party_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((requested_by = app.actor_id()) AND (((app.actor_kind() = 'HOST'::text) AND (action_code = 'HOST_DECLARE_NO_SHOW'::text) AND (status = 'PENDING'::text)) OR ((app.actor_kind() = 'GUEST'::text) AND (action_code = 'GUEST_REPORT_HOST_NO_SHOW'::text) AND (status = 'AWAITING_REVIEW'::text))))`
- `cmd_hold_cancel_review_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((status = 'AWAITING_REVIEW'::text) AND (action_code = 'GUEST_REPORT_HOST_NO_SHOW'::text) AND (app.actor_kind() = 'STAFF'::text))` WITH CHECK `((status = ANY (ARRAY['PENDING'::text, 'FAILED'::text])) AND (action_code = 'GUEST_REPORT_HOST_NO_SHOW'::text) AND (app.actor_kind() = 'STAFF'::text))`
- `cmd_hold_cancel_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_cancel_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((status = 'PENDING'::text) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((status = ANY (ARRAY['SETTLED'::text, 'FIN_REVIEW'::text, 'FAILED'::text])) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `cmd_money_cancel_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_cancellation_penalty_posted` : `CREATE TRIGGER trip_cancellation_penalty_posted AFTER UPDATE OF status ON core.booking_trip_cancellation FOR EACH ROW WHEN (new.status = 'SETTLED'::text AND old.status IS DISTINCT FROM 'SETTLED'::text) EXECUTE FUNCTION core.settlement_post_cancellation_penalty()`
- `trip_cancellation_refunded` : `CREATE CONSTRAINT TRIGGER trip_cancellation_refunded AFTER UPDATE OF status ON core.booking_trip_cancellation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.status = 'SETTLED'::text) EXECUTE FUNCTION core.settlement_assert_cancellation_refunded()`

### `core.booking_trip_driver`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `role` | `text` | oui | — |
| `approved_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `booking_trip_driver_pkey` : `PRIMARY KEY (trip_id, user_id)`
- `booking_trip_driver_trip_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `booking_trip_driver_user_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `trip_driver_beta_primary` : `CHECK (role = 'PRIMARY'::text)`

Index :

- `one_primary_driver_per_trip` : `CREATE UNIQUE INDEX one_primary_driver_per_trip ON core.booking_trip_driver USING btree (trip_id) WHERE (role = 'PRIMARY'::text)`
- `trip_driver_user_idx` : `CREATE INDEX trip_driver_user_idx ON core.booking_trip_driver USING btree (user_id)`

Politiques RLS :

- `cmd_trip_driver_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `(role = 'PRIMARY'::text)`
- `cmd_trip_driver_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_trip_driver FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`

### `core.booking_trip_segment`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `seq` | `integer` | oui | — |
| `period` | `tstzrange` | oui | — |
| `billable_days` | `integer` | non | — |
| `price_version` | `integer` | non | — |
| `due_at` | `timestamp with time zone` | non | — |
| `payment_status` | `text` | oui | `'CONFIRMED'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |
| `contract_document_id` | `uuid` | non | — |

Contraintes :

- `booking_trip_segment_contract_fkey` : `FOREIGN KEY (contract_document_id) REFERENCES core.contract_generated_document(id)`
- `booking_trip_segment_pkey` : `PRIMARY KEY (id)`
- `booking_trip_segment_trip_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `trip_segment_beta_single` : `CHECK (seq = 1)`
- `trip_segment_billable_days_positive` : `CHECK (billable_days IS NULL OR billable_days >= 1)`
- `trip_segment_payment_status_valid` : `CHECK (payment_status = ANY (ARRAY['CONFIRMED'::text, 'REFUNDED_PARTIAL'::text, 'REFUNDED'::text]))`
- `trip_segment_period_valid` : `CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period) AND lower(period) IS NOT NULL AND upper(period) IS NOT NULL)`
- `trip_segment_price_version_positive` : `CHECK (price_version IS NULL OR price_version >= 1)`
- `trip_segment_seq_unique` : `UNIQUE (trip_id, seq)`

Politiques RLS :

- `cmd_trip_seg_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `(seq = 1)`
- `cmd_trip_seg_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_trip_seg_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `(seq = 1)` WITH CHECK `(seq = 1)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_trip_segment FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_trip_segment FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_trip_state_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `from_status` | `text` | non | — |
| `to_status` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `reason_code` | `text` | oui | — |
| `origin` | `text` | non | — |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |
| `settlement_id` | `uuid` | non | — |
| `xact_id` | `xid8` | oui | `pg_current_xact_id()` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `booking_trip_state_log_pkey` : `PRIMARY KEY (id)`
- `booking_trip_state_log_settlement_fkey` : `FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement(id)`
- `booking_trip_state_log_trip_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `trip_state_log_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{0,31}$'::text)`
- `trip_state_log_actor_shape` : `CHECK (actor_role <> 'SYSTEM'::text OR actor_user_id IS NULL)`
- `trip_state_log_birth_shape` : `CHECK ((from_status IS NULL) = (to_status = 'BOOKED'::text AND kind = 'TRANSITION'::text AND reason_code = 'HOLD_CONVERTED'::text))`
- `trip_state_log_kind_valid` : `CHECK (kind = ANY (ARRAY['TRANSITION'::text, 'AUDIT_CORRECTION'::text]))`
- `trip_state_log_origin_valid` : `CHECK (origin IS NULL OR (origin = ANY (ARRAY['EVENT'::text, 'LATE_GUEST_CANCELLATION'::text, 'REQUALIFIED_NO_EVIDENCE'::text, 'PICKUP_CHECK'::text])))`
- `trip_state_log_reason_format` : `CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `trip_state_log_states_valid` : `CHECK ((from_status IS NULL OR (from_status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text, 'RETURNED'::text, 'UNRETURNED'::text, 'TERMINATED_EARLY'::text, 'VEHICLE_LOST'::text, 'POST_TRIP'::text, 'COMPLETED'::text, 'IN_DISPUTE'::text, 'CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text]))) AND (to_status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text, 'RETURNED'::text, 'UNRETURNED'::text, 'TERMINATED_EARLY'::text, 'VEHICLE_LOST'::text, 'POST_TRIP'::text, 'COMPLETED'::text, 'IN_DISPUTE'::text, 'CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text])))`

Index :

- `trip_state_log_trip_idx` : `CREATE INDEX trip_state_log_trip_idx ON core.booking_trip_state_log USING btree (trip_id, at)`

Politiques RLS :

- `cmd_money_payout_log_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_trip_log_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `(kind = 'TRANSITION'::text)`
- `cmd_trip_log_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `review_cmd_read` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_trip_state_log FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `trip_state_log_immutable` : `CREATE TRIGGER trip_state_log_immutable BEFORE UPDATE ON core.booking_trip_state_log FOR EACH ROW EXECUTE FUNCTION core.booking_trip_state_log_immutable()`

### `core.booking_trip_transition`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `from_status` | `text` | oui | — |
| `to_status` | `text` | oui | — |
| `via` | `text` | oui | — |

Contraintes :

- `trip_transition_pkey` : `PRIMARY KEY (from_status, to_status)`
- `trip_transition_states_valid` : `CHECK ((from_status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text, 'RETURNED'::text, 'UNRETURNED'::text, 'TERMINATED_EARLY'::text, 'VEHICLE_LOST'::text, 'POST_TRIP'::text, 'COMPLETED'::text, 'IN_DISPUTE'::text])) AND (to_status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text, 'RETURNED'::text, 'UNRETURNED'::text, 'TERMINATED_EARLY'::text, 'VEHICLE_LOST'::text, 'POST_TRIP'::text, 'COMPLETED'::text, 'IN_DISPUTE'::text, 'CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text])) AND from_status <> to_status)`
- `trip_transition_via_matches` : `CHECK ((via = 'CANCEL'::text) = (to_status = ANY (ARRAY['CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text])))`
- `trip_transition_via_valid` : `CHECK (via = ANY (ARRAY['TRANSITION'::text, 'CANCEL'::text]))`

Politiques RLS :

- `cmd_trip_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.booking_vehicle_occupancy`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `source` | `text` | oui | — |
| `period` | `tstzrange` | oui | — |
| `active` | `boolean` | oui | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `deactivated_reason` | `text` | non | — |
| `ref_type` | `text` | non | — |
| `ref_id` | `uuid` | non | — |
| `ical_uid` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |

Contraintes :

- `booking_vehicle_occupancy_pkey` : `PRIMARY KEY (id)`
- `hold_has_ttl` : `CHECK (kind <> 'HOLD'::text OR expires_at IS NOT NULL)`
- `inactive_has_reason` : `CHECK (active OR deactivated_reason IS NOT NULL)`
- `occupancy_catalog_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`
- `occupancy_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `occupancy_deactivated_reason_valid` : `CHECK (deactivated_reason = ANY (ARRAY['HOLD_EXPIRED'::text, 'HOLD_RELEASED'::text, 'HOLD_COMPENSATED'::text, 'TRIP_TERMINAL'::text, 'SHORTENED'::text, 'BLOCK_REMOVED'::text]))`
- `occupancy_kind_valid` : `CHECK (kind = ANY (ARRAY['TRIP'::text, 'HOLD'::text, 'HOST_BLOCK'::text, 'BUFFER'::text]))`
- `occupancy_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `occupancy_party_unique` : `UNIQUE (id, vehicle_id, org_id, country_code)`
- `occupancy_source_valid` : `CHECK (source = ANY (ARRAY['CHECKOUT'::text, 'MANUAL'::text, 'ICAL'::text, 'SYSTEM'::text]))`
- `occupancy_trip_guard` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `occupancy_trip_ref_valid` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `occupancy_vehicle_single_org` : `EXCLUDE USING gist (vehicle_id WITH =, org_id WITH <>)`
- `period_valid` : `CHECK (period IS NOT NULL AND NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period) AND lower_inc(period) AND NOT upper_inc(period))`
- `trip_has_no_ttl` : `CHECK (kind <> 'TRIP'::text OR expires_at IS NULL)`
- `trip_occupancy_has_ref` : `CHECK (kind <> 'TRIP'::text OR ref_type = 'TRIP'::text AND ref_id IS NOT NULL)`
- `vehicle_occupancy_no_overlap` : `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)`

Index :

- `occupancy_ical_uid_unique` : `CREATE UNIQUE INDEX occupancy_ical_uid_unique ON core.booking_vehicle_occupancy USING btree (vehicle_id, ical_uid) WHERE (source = 'ICAL'::text)`
- `occupancy_org_vehicle_idx` : `CREATE INDEX occupancy_org_vehicle_idx ON core.booking_vehicle_occupancy USING btree (org_id, vehicle_id)`
- `one_active_occupancy_per_trip` : `CREATE UNIQUE INDEX one_active_occupancy_per_trip ON core.booking_vehicle_occupancy USING btree (ref_id) WHERE ((kind = 'TRIP'::text) AND active)`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `active`
- `cmd_block_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((kind = 'HOST_BLOCK'::text) AND (source = 'MANUAL'::text) AND active AND (expires_at IS NULL) AND (ref_type IS NULL) AND (ref_id IS NULL) AND (app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()))`
- `cmd_block_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'HOST_BLOCK'::text) AND (source = 'MANUAL'::text) AND active AND (app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()))` WITH CHECK `((kind = 'HOST_BLOCK'::text) AND (source = 'MANUAL'::text) AND (NOT active) AND (deactivated_reason = 'BLOCK_REMOVED'::text) AND (app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()))`
- `cmd_buffer_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((kind = 'BUFFER'::text) AND (source = 'SYSTEM'::text) AND active AND (expires_at IS NULL) AND (ref_type = 'TRIP'::text) AND (ref_id IS NOT NULL) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `cmd_hold_request_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'HOLD'::text) AND active AND (ref_type = 'HOLD'::text) AND (((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id())) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['hold_expiry'::text, 'booking_conversion'::text])))))` WITH CHECK `((kind = 'HOLD'::text) AND (NOT active) AND (deactivated_reason = ANY (ARRAY['HOLD_EXPIRED'::text, 'HOLD_RELEASED'::text])) AND (((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id())) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['hold_expiry'::text, 'booking_conversion'::text])))))`
- `cmd_occ_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((kind = 'HOLD'::text) AND (source = 'CHECKOUT'::text) AND active AND (expires_at IS NOT NULL) AND (ref_type = 'HOLD'::text) AND (ref_id IS NOT NULL) AND (app.actor_kind() = 'GUEST'::text))`
- `cmd_occ_review_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'HOLD'::text) AND active AND (ref_type = 'HOLD'::text))` WITH CHECK `((kind = 'HOLD'::text) AND (ref_type = 'HOLD'::text) AND (active OR (deactivated_reason = 'HOLD_RELEASED'::text)))`
- `cmd_occ_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'HOLD'::text) AND active AND (app.actor_kind() = 'GUEST'::text))` WITH CHECK `((kind = 'HOLD'::text) AND (NOT active) AND (app.actor_kind() = 'GUEST'::text) AND (deactivated_reason = ANY (ARRAY['HOLD_EXPIRED'::text, 'HOLD_RELEASED'::text])))`
- `cmd_trip_handover_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'TRIP'::text) AND (ref_type = 'TRIP'::text) AND active AND (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE ((t.id = booking_vehicle_occupancy.ref_id) AND (t.status = 'RETURNED'::text) AND (((app.actor_kind() = 'HOST'::text) AND (t.org_id = app.org_id())) OR ((app.actor_kind() = 'GUEST'::text) AND (t.guest_user_id = app.actor_id())))))))` WITH CHECK `((kind = 'TRIP'::text) AND (ref_type = 'TRIP'::text) AND (NOT active) AND (deactivated_reason = 'TRIP_TERMINAL'::text) AND (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE ((t.id = booking_vehicle_occupancy.ref_id) AND (t.status = 'RETURNED'::text) AND (((app.actor_kind() = 'HOST'::text) AND (t.org_id = app.org_id())) OR ((app.actor_kind() = 'GUEST'::text) AND (t.guest_user_id = app.actor_id())))))))`
- `cmd_trip_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'TRIP'::text) AND active AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((kind = 'TRIP'::text) AND (NOT active) AND (deactivated_reason = 'TRIP_TERMINAL'::text) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `cmd_trip_overdue_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'TRIP'::text) AND (ref_type = 'TRIP'::text) AND active AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text) AND (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE ((t.id = booking_vehicle_occupancy.ref_id) AND (t.status = 'OVERDUE'::text)))))` WITH CHECK `((kind = 'TRIP'::text) AND (ref_type = 'TRIP'::text) AND active AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text) AND (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE ((t.id = booking_vehicle_occupancy.ref_id) AND (t.status = 'OVERDUE'::text)))))`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `occupancy_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND app.host_covers_vehicle(vehicle_id))`
- `occupancy_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND app.has_staff_role('ADMIN'::text, country_code))`
- `probe_read` (SELECT, PERMISSIVE, catalog_probe_owner) USING `active`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'trip_lifecycle'::text, 'booking_oracle'::text])))`
- `worker_update_conversion` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`
- `worker_update_expiry` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (kind = 'HOLD'::text) AND active)` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (kind = 'HOLD'::text) AND (NOT active))`
- `worker_update_trip` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text) AND (kind = 'TRIP'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text) AND (kind = 'TRIP'::text))`

Déclencheurs :

- `occupancy_trip_guard` : `CREATE CONSTRAINT TRIGGER occupancy_trip_guard AFTER DELETE OR UPDATE ON core.booking_vehicle_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (old.kind = 'TRIP'::text) EXECUTE FUNCTION core.booking_assert_trip_occupancy('occupancy_trip_guard')`
- `occupancy_trip_ref_valid` : `CREATE CONSTRAINT TRIGGER occupancy_trip_ref_valid AFTER INSERT OR UPDATE ON core.booking_vehicle_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.kind = 'TRIP'::text AND new.active) EXECUTE FUNCTION core.booking_assert_trip_occupancy('occupancy_trip_ref_valid')`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_vehicle_occupancy FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.catalog_addition_request`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `origin` | `text` | oui | `'WIZARD_OTHER'::text` |
| `make_text` | `text` | oui | — |
| `model_text` | `text` | oui | — |
| `year` | `integer` | oui | — |
| `trim_text` | `text` | non | — |
| `vin_masked` | `text` | non | — |
| `status` | `text` | oui | `'OPEN'::text` |
| `resolved_variant_id` | `uuid` | non | — |
| `reject_reason` | `text` | non | — |
| `reviewed_by` | `uuid` | non | — |
| `reviewed_at` | `timestamp with time zone` | non | — |
| `review_item_id` | `uuid` | non | — |
| `sla_due_at` | `timestamp with time zone` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_addition_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_addition_make_valid` : `CHECK (btrim(make_text) <> ''::text AND char_length(make_text) <= 80)`
- `catalog_addition_model_valid` : `CHECK (btrim(model_text) <> ''::text AND char_length(model_text) <= 80)`
- `catalog_addition_origin_valid` : `CHECK (origin = ANY (ARRAY['WIZARD_OTHER'::text, 'OPS'::text]))`
- `catalog_addition_reject_reason_valid` : `CHECK (reject_reason = ANY (ARRAY['INSUFFICIENT_DETAILS'::text, 'UNKNOWN_MODEL'::text, 'NOT_ELIGIBLE'::text]))`
- `catalog_addition_rejected` : `CHECK ((status = 'REJECTED'::text) = (reject_reason IS NOT NULL))`
- `catalog_addition_request_pkey` : `PRIMARY KEY (id)`
- `catalog_addition_request_requested_by_fkey` : `FOREIGN KEY (requested_by) REFERENCES core.iam_user_account(id)`
- `catalog_addition_request_resolved_variant_id_fkey` : `FOREIGN KEY (resolved_variant_id) REFERENCES core.catalog_vehicle_variant(id)`
- `catalog_addition_request_review_item_id_fkey` : `FOREIGN KEY (review_item_id) REFERENCES core.support_review_queue_item(id)`
- `catalog_addition_request_reviewed_by_fkey` : `FOREIGN KEY (reviewed_by) REFERENCES core.iam_user_account(id)`
- `catalog_addition_reviewed` : `CHECK ((status = 'OPEN'::text) = (reviewed_by IS NULL) AND (reviewed_by IS NULL) = (reviewed_at IS NULL))`
- `catalog_addition_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'APPROVED'::text, 'MERGED'::text, 'REJECTED'::text]))`
- `catalog_addition_trim_valid` : `CHECK (trim_text IS NULL OR btrim(trim_text) <> ''::text AND char_length(trim_text) <= 80)`
- `catalog_addition_variant` : `CHECK ((status = ANY (ARRAY['APPROVED'::text, 'MERGED'::text])) = (resolved_variant_id IS NOT NULL))`
- `catalog_addition_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`
- `catalog_addition_vin_masked_format` : `CHECK (vin_masked ~ '^[A-HJ-NPR-Z0-9]{11}\*{6}$'::text)`
- `catalog_addition_year_range` : `CHECK (year >= 1950 AND year <= 2100)`

Index :

- `catalog_addition_org_idx` : `CREATE INDEX catalog_addition_org_idx ON core.catalog_addition_request USING btree (org_id, vehicle_id, created_at)`
- `catalog_addition_vehicle_open_unique` : `CREATE UNIQUE INDEX catalog_addition_vehicle_open_unique ON core.catalog_addition_request USING btree (vehicle_id) WHERE (status = 'OPEN'::text)`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_addition_no_delete` : `CREATE TRIGGER catalog_addition_no_delete BEFORE DELETE ON core.catalog_addition_request FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_addition_no_truncate` : `CREATE TRIGGER catalog_addition_no_truncate BEFORE TRUNCATE ON core.catalog_addition_request FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_deposit_policy`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `value_class` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `currency` | `text` | oui | — |
| `accepted_methods` | `text[]` | oui | — |
| `covered_items` | `text[]` | oui | — |
| `excluded_items` | `text[]` | oui | `'{}'::text[]` |
| `covers_damage` | `boolean` | oui | `false` |
| `valid_from` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_deposit_policy_amount_valid` : `CHECK (amount_minor >= 0)`
- `catalog_deposit_policy_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_deposit_policy_covered_valid` : `CHECK (covered_items <@ ARRAY['FUEL'::text, 'CLEANING'::text, 'TOLLS'::text, 'FINES'::text, 'LATE_RETURN'::text, 'KEYS'::text])`
- `catalog_deposit_policy_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `catalog_deposit_policy_methods_valid` : `CHECK (cardinality(accepted_methods) > 0 AND accepted_methods <@ ARRAY['CARD_PREAUTH'::text, 'CARD_CHARGE_THEN_REFUND'::text])`
- `catalog_deposit_policy_no_damage` : `CHECK (NOT covers_damage)`
- `catalog_deposit_policy_pkey` : `PRIMARY KEY (id)`
- `catalog_deposit_policy_unique` : `UNIQUE (country_code, value_class, valid_from)`
- `catalog_deposit_policy_value_class_valid` : `CHECK (value_class = ANY (ARRAY['STANDARD'::text, 'PREMIUM'::text, 'LUXE'::text]))`

Politiques RLS :

- `catalog_cmd_search_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.catalog_listing`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | `'DRAFT'::text` |
| `daily_price_minor` | `bigint` | oui | — |
| `currency` | `text` | oui | — |
| `mileage_mode` | `text` | oui | — |
| `included_km_per_day` | `integer` | non | — |
| `extra_km_price_minor` | `bigint` | non | — |
| `instant_book` | `boolean` | oui | `true` |
| `deposit_policy_id` | `uuid` | non | — |
| `submitted_at` | `timestamp with time zone` | non | — |
| `published_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | oui | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `catalog_listing_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_listing_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `catalog_listing_deposit_policy_id_fkey` : `FOREIGN KEY (deposit_policy_id) REFERENCES core.catalog_deposit_policy(id)`
- `catalog_listing_mileage_mode_valid` : `CHECK (mileage_mode = ANY (ARRAY['UNLIMITED'::text, 'INCLUDED'::text]))`
- `catalog_listing_mileage_valid` : `CHECK (mileage_mode = 'UNLIMITED'::text AND included_km_per_day IS NULL AND extra_km_price_minor IS NULL OR mileage_mode = 'INCLUDED'::text AND included_km_per_day >= 1 AND included_km_per_day <= 10000 AND extra_km_price_minor >= 0 AND extra_km_price_minor <= '10000000000000'::bigint)`
- `catalog_listing_party_unique` : `UNIQUE (id, org_id, country_code)`
- `catalog_listing_pkey` : `PRIMARY KEY (id)`
- `catalog_listing_price_bound` : `CHECK (daily_price_minor <= '10000000000000'::bigint)`
- `catalog_listing_price_positive` : `CHECK (daily_price_minor > 0)`
- `catalog_listing_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'BLOCKED_ELIGIBILITY'::text, 'PENDING_REVIEW'::text, 'LISTED'::text, 'REJECTED'::text, 'SNOOZED'::text, 'UNLISTED'::text, 'RESTRICTED'::text, 'REMOVED_BY_PLATFORM'::text, 'DELETED'::text]))`
- `catalog_listing_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`

Index :

- `catalog_listing_org_idx` : `CREATE INDEX catalog_listing_org_idx ON core.catalog_listing USING btree (org_id)`
- `catalog_listing_vehicle_live_unique` : `CREATE UNIQUE INDEX catalog_listing_vehicle_live_unique ON core.catalog_listing USING btree (vehicle_id) WHERE (status <> 'DELETED'::text)`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `probe_read` (SELECT, PERMISSIVE, catalog_probe_owner) USING `(status = 'LISTED'::text)`
- `review_cmd_read` (SELECT, PERMISSIVE, review_cmd_owner) USING `(status = 'LISTED'::text)`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.catalog_listing FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.catalog_listing_photo`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `listing_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `file_id` | `uuid` | oui | — |
| `position` | `smallint` | oui | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `alt_text` | `text` | non | — |
| `deleted_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | oui | — |

Contraintes :

- `catalog_listing_photo_alt_valid` : `CHECK (alt_text IS NULL OR char_length(alt_text) <= 300)`
- `catalog_listing_photo_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_listing_photo_file_id_fkey` : `FOREIGN KEY (file_id) REFERENCES core.audit_file_asset(id)`
- `catalog_listing_photo_file_unique` : `UNIQUE (file_id)`
- `catalog_listing_photo_listing_fk` : `FOREIGN KEY (listing_id, org_id, country_code) REFERENCES core.catalog_listing(id, org_id, country_code)`
- `catalog_listing_photo_pkey` : `PRIMARY KEY (id)`
- `catalog_listing_photo_position_range` : `CHECK ("position" >= 0 AND "position" <= 999)`
- `catalog_listing_photo_position_unique` : `UNIQUE (listing_id, "position")`
- `catalog_listing_photo_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]))`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.catalog_location`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | `'HOME'::text` |
| `place_label` | `text` | oui | — |
| `address_line` | `text` | oui | — |
| `city` | `text` | oui | — |
| `area_label` | `text` | non | — |
| `geo` | `point` | non | — |
| `geo_public` | `point` | non | `point((round((geo[0])::numeric, 2))::double precision, (round((geo[1])::numeric, 2))::double precision)` |
| `timezone` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | oui | — |
| `advance_notice_minutes` | `integer` | non | — |

Contraintes :

- `catalog_location_address_valid` : `CHECK (btrim(address_line) <> ''::text AND char_length(address_line) <= 200)`
- `catalog_location_area_valid` : `CHECK (area_label IS NULL OR btrim(area_label) <> ''::text AND char_length(area_label) <= 80)`
- `catalog_location_city_valid` : `CHECK (btrim(city) <> ''::text AND char_length(city) <= 80)`
- `catalog_location_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_location_geo_range` : `CHECK (geo[1] >= '-90'::integer::double precision AND geo[1] <= 90::double precision AND geo[0] >= '-180'::integer::double precision AND geo[0] <= 180::double precision)`
- `catalog_location_kind_valid` : `CHECK (kind = ANY (ARRAY['HOME'::text, 'POI'::text, 'AIRPORT'::text]))`
- `catalog_location_label_valid` : `CHECK (btrim(place_label) <> ''::text AND char_length(place_label) <= 80)`
- `catalog_location_notice_valid` : `CHECK (advance_notice_minutes IS NULL OR advance_notice_minutes >= 0 AND advance_notice_minutes <= 10080 AND (advance_notice_minutes % 30) = 0)`
- `catalog_location_org_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `catalog_location_party_unique` : `UNIQUE (id, org_id, country_code)`
- `catalog_location_pkey` : `PRIMARY KEY (id)`
- `catalog_location_timezone_valid` : `CHECK (btrim(timezone) <> ''::text)`

Index :

- `catalog_location_org_idx` : `CREATE INDEX catalog_location_org_idx ON core.catalog_location USING btree (org_id)`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.catalog_offplatform_pattern`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `text` | oui | — |
| `lang` | `text` | oui | — |
| `pattern` | `text` | oui | — |
| `story` | `text` | oui | — |
| `applies_to` | `text` | oui | `'ALL'::text` |

Contraintes :

- `catalog_offplatform_pattern_applies_to_valid` : `CHECK (applies_to = ANY (ARRAY['ALL'::text, 'MESSAGE'::text]))`
- `catalog_offplatform_pattern_code_format` : `CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `catalog_offplatform_pattern_lang_valid` : `CHECK (lang = ANY (ARRAY['*'::text, 'es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `catalog_offplatform_pattern_pattern_size` : `CHECK (char_length(pattern) >= 3 AND char_length(pattern) <= 300)`
- `catalog_offplatform_pattern_pkey` : `PRIMARY KEY (code)`
- `catalog_offplatform_pattern_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(applies_to = 'ALL'::text)`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.catalog_value_class_rule`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `country_code` | `text` | non | — |
| `make_slug` | `text` | oui | — |
| `model_slug` | `text` | non | — |
| `value_class` | `text` | oui | — |
| `status` | `text` | oui | `'ACTIVE'::text` |
| `source_ref` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_value_class_rule_class_valid` : `CHECK (value_class = ANY (ARRAY['STANDARD'::text, 'PREMIUM'::text, 'LUXE'::text]))`
- `catalog_value_class_rule_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_value_class_rule_make_slug_format` : `CHECK (make_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)`
- `catalog_value_class_rule_model_slug_format` : `CHECK (model_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)`
- `catalog_value_class_rule_pkey` : `PRIMARY KEY (id)`
- `catalog_value_class_rule_source_ref_valid` : `CHECK (char_length(source_ref) >= 3 AND char_length(source_ref) <= 300)`
- `catalog_value_class_rule_status_valid` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))`
- `catalog_value_class_rule_unique` : `UNIQUE NULLS NOT DISTINCT (country_code, make_slug, model_slug)`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_value_class_rule_no_delete` : `CREATE TRIGGER catalog_value_class_rule_no_delete BEFORE DELETE ON core.catalog_value_class_rule FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_value_class_rule_no_truncate` : `CREATE TRIGGER catalog_value_class_rule_no_truncate BEFORE TRUNCATE ON core.catalog_value_class_rule FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `home_location_id` | `uuid` | oui | — |
| `timezone` | `text` | oui | — |
| `plate` | `text` | oui | — |
| `vin` | `text` | non | — |
| `plate_category` | `text` | oui | `'PARTICULAR'::text` |
| `insurer_eligibility` | `text` | oui | `'PENDING'::text` |
| `variant_id` | `uuid` | non | — |
| `make_text` | `text` | non | — |
| `model_text` | `text` | non | — |
| `year` | `integer` | oui | — |
| `trim_override` | `text` | non | — |
| `value_class` | `text` | non | — |
| `transmission` | `text` | oui | — |
| `seats` | `smallint` | oui | — |
| `fuel_type` | `text` | oui | — |
| `odometer_km` | `integer` | non | — |
| `eligibility_status` | `text` | oui | `'PENDING'::text` |
| `lien_declared` | `boolean` | oui | `false` |
| `gps_installed` | `boolean` | oui | `false` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | oui | — |
| `title_holder` | `text` | non | — |
| `eligibility_reasons` | `text[]` | oui | `'{}'::text[]` |
| `eligibility_submitted_at` | `timestamp with time zone` | non | — |
| `eligibility_checked_at` | `timestamp with time zone` | non | — |
| `released_at` | `timestamp with time zone` | non | — |
| `ownership_attested_at` | `timestamp with time zone` | non | — |
| `lien_attested_at` | `timestamp with time zone` | non | — |
| `value_class_source` | `text` | non | — |
| `value_class_rule_id` | `uuid` | non | — |

Contraintes :

- `catalog_vehicle_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_vehicle_eligibility_reasons_format` : `CHECK (array_to_string(eligibility_reasons, ','::text) ~ '^([A-Z][A-Z_]{1,63}(,\|$))*$'::text)`
- `catalog_vehicle_eligibility_valid` : `CHECK (eligibility_status = ANY (ARRAY['ELIGIBLE'::text, 'INELIGIBLE'::text, 'PENDING'::text]))`
- `catalog_vehicle_fuel_valid` : `CHECK (fuel_type = ANY (ARRAY['GASOLINE'::text, 'DIESEL'::text, 'HYBRID'::text, 'EV'::text]))`
- `catalog_vehicle_identity` : `CHECK (variant_id IS NOT NULL AND make_text IS NULL AND model_text IS NULL OR variant_id IS NULL AND make_text IS NOT NULL AND model_text IS NOT NULL)`
- `catalog_vehicle_insurer_eligibility_valid` : `CHECK (insurer_eligibility = ANY (ARRAY['ELIGIBLE'::text, 'INELIGIBLE'::text, 'PENDING'::text]))`
- `catalog_vehicle_location_fk` : `FOREIGN KEY (home_location_id, org_id, country_code) REFERENCES core.catalog_location(id, org_id, country_code)`
- `catalog_vehicle_make_text_valid` : `CHECK (make_text IS NULL OR btrim(make_text) <> ''::text AND char_length(make_text) <= 80)`
- `catalog_vehicle_model_text_valid` : `CHECK (model_text IS NULL OR btrim(model_text) <> ''::text AND char_length(model_text) <= 80)`
- `catalog_vehicle_odometer_range` : `CHECK (odometer_km >= 0 AND odometer_km <= 3000000)`
- `catalog_vehicle_org_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `catalog_vehicle_party_unique` : `UNIQUE (id, org_id, country_code)`
- `catalog_vehicle_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_plate_category_valid` : `CHECK (plate_category = 'PARTICULAR'::text)`
- `catalog_vehicle_plate_normalized` : `CHECK (plate ~ '^[A-Z0-9]{2,12}$'::text)`
- `catalog_vehicle_plate_unique` : `EXCLUDE USING btree (country_code WITH =, plate WITH =) WHERE (released_at IS NULL)`
- `catalog_vehicle_seats_range` : `CHECK (seats >= 1 AND seats <= 60)`
- `catalog_vehicle_timezone_valid` : `CHECK (btrim(timezone) <> ''::text)`
- `catalog_vehicle_title_holder_valid` : `CHECK (title_holder = ANY (ARRAY['HOST'::text, 'THIRD_PARTY'::text]))`
- `catalog_vehicle_transmission_valid` : `CHECK (transmission = ANY (ARRAY['MANUAL'::text, 'AUTOMATIC'::text]))`
- `catalog_vehicle_trim_valid` : `CHECK (trim_override IS NULL OR btrim(trim_override) <> ''::text AND char_length(trim_override) <= 80)`
- `catalog_vehicle_value_class_rule_id_fkey` : `FOREIGN KEY (value_class_rule_id) REFERENCES core.catalog_value_class_rule(id)`
- `catalog_vehicle_value_class_rule_match` : `CHECK ( CASE WHEN value_class_source = ANY (ARRAY['MODEL_RULE'::text, 'MAKE_RULE'::text]) THEN value_class_rule_id IS NOT NULL ELSE value_class_rule_id IS NULL END)`
- `catalog_vehicle_value_class_source_known` : `CHECK (value_class_source IS NULL OR value_class IS NOT NULL)`
- `catalog_vehicle_value_class_source_valid` : `CHECK (value_class_source = ANY (ARRAY['CATALOG'::text, 'MODEL_RULE'::text, 'MAKE_RULE'::text, 'COUNTRY_DEFAULT'::text]))`
- `catalog_vehicle_value_class_valid` : `CHECK (value_class = ANY (ARRAY['STANDARD'::text, 'PREMIUM'::text, 'LUXE'::text]))`
- `catalog_vehicle_variant_id_fkey` : `FOREIGN KEY (variant_id) REFERENCES core.catalog_vehicle_variant(id)`
- `catalog_vehicle_vin_format` : `CHECK (vin ~ '^[A-Z0-9]{5,17}$'::text)`
- `catalog_vehicle_vin_iso` : `CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'::text OR vin ~ '^[A-Z0-9]{5,16}$'::text)`
- `catalog_vehicle_year_range` : `CHECK (year >= 1950 AND year <= 2100)`

Index :

- `catalog_vehicle_org_idx` : `CREATE INDEX catalog_vehicle_org_idx ON core.catalog_vehicle USING btree (org_id)`
- `catalog_vehicle_vin_unique` : `CREATE UNIQUE INDEX catalog_vehicle_vin_unique ON core.catalog_vehicle USING btree (vin) WHERE ((vin IS NOT NULL) AND (released_at IS NULL))`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `catalog_vehicle_value_class_follow` : `CREATE TRIGGER catalog_vehicle_value_class_follow BEFORE UPDATE OF variant_id ON core.catalog_vehicle FOR EACH ROW WHEN (old.variant_id IS DISTINCT FROM new.variant_id AND old.value_class_source IS NOT NULL) EXECUTE FUNCTION core.catalog_vehicle_value_class_follow()`

### `core.catalog_vehicle_attestation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `vehicle_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `user_id` | `uuid` | oui | — |
| `statement` | `text` | oui | — |
| `statement_key` | `text` | oui | — |
| `catalog_version` | `integer` | non | — |
| `locale` | `text` | non | — |
| `statement_text` | `text` | non | — |
| `attested_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_vehicle_attestation_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_vehicle_attestation_key_matches` : `CHECK ((statement = 'OWNERSHIP'::text) = (statement_key = 'web.vehicleDocs.declaration.owner'::text))`
- `catalog_vehicle_attestation_key_valid` : `CHECK (statement_key = ANY (ARRAY['web.vehicleDocs.declaration.owner'::text, 'web.vehicleDocs.declaration.lienOk'::text]))`
- `catalog_vehicle_attestation_locale_valid` : `CHECK (locale = ANY (ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `catalog_vehicle_attestation_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_attestation_statement_valid` : `CHECK (statement = ANY (ARRAY['OWNERSHIP'::text, 'LIEN'::text]))`
- `catalog_vehicle_attestation_text_valid` : `CHECK (btrim(statement_text) <> ''::text AND char_length(statement_text) <= 500)`
- `catalog_vehicle_attestation_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `catalog_vehicle_attestation_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`
- `catalog_vehicle_attestation_version_range` : `CHECK (catalog_version >= 1 AND catalog_version <= 999999)`
- `catalog_vehicle_attestation_wording` : `CHECK ((catalog_version IS NULL) = (locale IS NULL) AND (locale IS NULL) = (statement_text IS NULL))`

Index :

- `catalog_vehicle_attestation_vehicle_idx` : `CREATE INDEX catalog_vehicle_attestation_vehicle_idx ON core.catalog_vehicle_attestation USING btree (vehicle_id, attested_at)`

Politiques RLS :

- `catalog_cmd_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `true`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_attestation_append_only` : `CREATE TRIGGER catalog_vehicle_attestation_append_only BEFORE DELETE OR UPDATE ON core.catalog_vehicle_attestation FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_attestation_no_truncate` : `CREATE TRIGGER catalog_vehicle_attestation_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_attestation FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle_claim`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `claimant_user_id` | `uuid` | oui | — |
| `plate` | `text` | oui | — |
| `vin` | `text` | non | — |
| `target_vehicle_id` | `uuid` | oui | — |
| `title_file_id` | `uuid` | oui | — |
| `mime` | `text` | oui | — |
| `bytes` | `bigint` | oui | — |
| `status` | `text` | oui | `'OPEN'::text` |
| `dismiss_reason` | `text` | non | — |
| `checklist` | `jsonb` | non | — |
| `review_item_id` | `uuid` | non | — |
| `decided_by` | `uuid` | non | — |
| `decided_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_vehicle_claim_bytes_range` : `CHECK (bytes >= 1 AND bytes <= 10485760)`
- `catalog_vehicle_claim_claimant_user_id_fkey` : `FOREIGN KEY (claimant_user_id) REFERENCES core.iam_user_account(id)`
- `catalog_vehicle_claim_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_vehicle_claim_decided` : `CHECK ((status = 'OPEN'::text) = (decided_by IS NULL) AND (decided_by IS NULL) = (decided_at IS NULL))`
- `catalog_vehicle_claim_dismiss_reason_valid` : `CHECK (dismiss_reason = ANY (ARRAY['INSUFFICIENT_PROOF'::text, 'CLAIMANT_NOT_OWNER'::text]))`
- `catalog_vehicle_claim_dismissed` : `CHECK ((status = 'DISMISSED'::text) = (dismiss_reason IS NOT NULL))`
- `catalog_vehicle_claim_file_unique` : `UNIQUE (title_file_id)`
- `catalog_vehicle_claim_mime_valid` : `CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/heic'::text, 'application/pdf'::text]))`
- `catalog_vehicle_claim_org_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `catalog_vehicle_claim_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_claim_plate_normalized` : `CHECK (plate ~ '^[A-Z0-9]{2,12}$'::text)`
- `catalog_vehicle_claim_review_item_id_fkey` : `FOREIGN KEY (review_item_id) REFERENCES core.support_review_queue_item(id)`
- `catalog_vehicle_claim_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'UPHELD'::text, 'DISMISSED'::text]))`
- `catalog_vehicle_claim_target_vehicle_id_fkey` : `FOREIGN KEY (target_vehicle_id) REFERENCES core.catalog_vehicle(id)`
- `catalog_vehicle_claim_title_file_id_fkey` : `FOREIGN KEY (title_file_id) REFERENCES core.audit_file_asset(id)`
- `catalog_vehicle_claim_upheld_checked` : `CHECK (status <> 'UPHELD'::text OR checklist IS NOT NULL)`
- `catalog_vehicle_claim_vin_format` : `CHECK (vin ~ '^[A-Z0-9]{5,17}$'::text)`

Index :

- `catalog_vehicle_claim_open_unique` : `CREATE UNIQUE INDEX catalog_vehicle_claim_open_unique ON core.catalog_vehicle_claim USING btree (org_id, target_vehicle_id) WHERE (status = 'OPEN'::text)`
- `catalog_vehicle_claim_target_idx` : `CREATE INDEX catalog_vehicle_claim_target_idx ON core.catalog_vehicle_claim USING btree (target_vehicle_id)`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_claim_no_delete` : `CREATE TRIGGER catalog_vehicle_claim_no_delete BEFORE DELETE ON core.catalog_vehicle_claim FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_claim_no_truncate` : `CREATE TRIGGER catalog_vehicle_claim_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_claim FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle_document`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `doc_type` | `text` | oui | — |
| `file_id` | `uuid` | oui | — |
| `mime` | `text` | oui | — |
| `bytes` | `bigint` | oui | — |
| `status` | `text` | oui | `'SUBMITTED'::text` |
| `valid_until` | `date` | non | — |
| `reject_reason` | `text` | non | — |
| `uploaded_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `reviewed_by` | `uuid` | non | — |
| `reviewed_at` | `timestamp with time zone` | non | — |

Contraintes :

- `catalog_vehicle_document_bytes_range` : `CHECK (bytes >= 1 AND bytes <= 10485760)`
- `catalog_vehicle_document_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_vehicle_document_file_id_fkey` : `FOREIGN KEY (file_id) REFERENCES core.audit_file_asset(id)`
- `catalog_vehicle_document_file_unique` : `UNIQUE (file_id)`
- `catalog_vehicle_document_mime_valid` : `CHECK (mime = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/heic'::text, 'application/pdf'::text]))`
- `catalog_vehicle_document_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_document_reject_reason_valid` : `CHECK (reject_reason = ANY (ARRAY['ILLEGIBLE'::text, 'EXPIRED'::text, 'MISMATCH'::text, 'WRONG_DOCUMENT'::text, 'SUSPECTED_FORGERY'::text]))`
- `catalog_vehicle_document_rejected` : `CHECK ((status = 'REJECTED'::text) = (reject_reason IS NOT NULL))`
- `catalog_vehicle_document_reviewed` : `CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))`
- `catalog_vehicle_document_status_valid` : `CHECK (status = ANY (ARRAY['SUBMITTED'::text, 'VALID'::text, 'REJECTED'::text, 'SUPERSEDED'::text]))`
- `catalog_vehicle_document_type_valid` : `CHECK (doc_type = ANY (ARRAY['TITLE'::text, 'OWNER_AUTHORIZATION'::text, 'PLATE_VIN_PHOTO'::text, 'INSPECTION'::text, 'LENDER_CONSENT'::text, 'COMPULSORY_INSURANCE'::text]))`
- `catalog_vehicle_document_valid_until_range` : `CHECK (valid_until >= '1950-01-01'::date AND valid_until <= '2100-12-31'::date)`
- `catalog_vehicle_document_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`

Index :

- `catalog_vehicle_document_live_unique` : `CREATE UNIQUE INDEX catalog_vehicle_document_live_unique ON core.catalog_vehicle_document USING btree (vehicle_id, doc_type) WHERE (status = ANY (ARRAY['SUBMITTED'::text, 'VALID'::text]))`
- `catalog_vehicle_document_org_idx` : `CREATE INDEX catalog_vehicle_document_org_idx ON core.catalog_vehicle_document USING btree (org_id)`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_document_no_delete` : `CREATE TRIGGER catalog_vehicle_document_no_delete BEFORE DELETE ON core.catalog_vehicle_document FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_document_no_truncate` : `CREATE TRIGGER catalog_vehicle_document_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_document FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle_earnings_plan`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `vehicle_id` | `uuid` | oui | — |
| `version` | `integer` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `plan_code` | `text` | oui | — |
| `chosen_by` | `uuid` | oui | — |
| `chosen_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_earnings_plan_code_format` : `CHECK (plan_code ~ '^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$'::text)`
- `catalog_earnings_plan_version_positive` : `CHECK (version >= 1)`
- `catalog_vehicle_earnings_plan_chosen_by_fkey` : `FOREIGN KEY (chosen_by) REFERENCES core.iam_user_account(id)`
- `catalog_vehicle_earnings_plan_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `catalog_vehicle_earnings_plan_pkey` : `PRIMARY KEY (vehicle_id, version)`
- `catalog_vehicle_earnings_plan_vehicle_id_fkey` : `FOREIGN KEY (vehicle_id) REFERENCES core.catalog_vehicle(id)`

Politiques RLS :

- `catalog_cmd_ins` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `true`
- `catalog_cmd_sel` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_earnings_plan_guard` : `CREATE TRIGGER catalog_vehicle_earnings_plan_guard BEFORE DELETE OR UPDATE ON core.catalog_vehicle_earnings_plan FOR EACH ROW EXECUTE FUNCTION core.catalog_earnings_plan_guard()`
- `catalog_vehicle_earnings_plan_no_truncate` : `CREATE TRIGGER catalog_vehicle_earnings_plan_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_earnings_plan FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_earnings_plan_guard()`

### `core.catalog_vehicle_eligibility_check`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : catalog_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `result` | `text` | oui | — |
| `reasons` | `text[]` | oui | `'{}'::text[]` |
| `checklist` | `jsonb` | non | — |
| `actor_user_id` | `uuid` | oui | — |
| `actor_role` | `text` | oui | — |
| `review_item_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_vehicle_check_checklist` : `CHECK ((kind = 'OPS_REVIEW'::text) = (checklist IS NOT NULL))`
- `catalog_vehicle_check_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `catalog_vehicle_check_kind_valid` : `CHECK (kind = ANY (ARRAY['AUTO_SUBMISSION'::text, 'OPS_REVIEW'::text, 'CLAIM_RELEASE'::text]))`
- `catalog_vehicle_check_reasons_format` : `CHECK (array_to_string(reasons, ','::text) ~ '^([A-Z][A-Z_]{1,63}(,\|$))*$'::text)`
- `catalog_vehicle_check_result_valid` : `CHECK (result = ANY (ARRAY['SUBMITTED'::text, 'REFUSED'::text, 'ELIGIBLE'::text, 'PENDING'::text, 'INELIGIBLE'::text]))`
- `catalog_vehicle_check_role_valid` : `CHECK (actor_role = ANY (ARRAY['P2P_HOST'::text, 'OPS_AGENT'::text, 'ADMIN'::text]))`
- `catalog_vehicle_check_vehicle_fk` : `FOREIGN KEY (vehicle_id, org_id, country_code) REFERENCES core.catalog_vehicle(id, org_id, country_code)`
- `catalog_vehicle_eligibility_check_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_eligibility_check_review_item_id_fkey` : `FOREIGN KEY (review_item_id) REFERENCES core.support_review_queue_item(id)`

Index :

- `catalog_vehicle_check_vehicle_idx` : `CREATE INDEX catalog_vehicle_check_vehicle_idx ON core.catalog_vehicle_eligibility_check USING btree (vehicle_id, created_at)`

Politiques RLS :

- `catalog_cmd_all` (ALL, PERMISSIVE, catalog_cmd_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_check_append_only` : `CREATE TRIGGER catalog_vehicle_check_append_only BEFORE DELETE OR UPDATE ON core.catalog_vehicle_eligibility_check FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_check_no_truncate` : `CREATE TRIGGER catalog_vehicle_check_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_eligibility_check FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle_make`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `slug` | `text` | oui | — |
| `name` | `text` | oui | — |
| `country_origin` | `character(2)` | non | — |
| `aliases` | `text[]` | oui | `ARRAY[]::text[]` |
| `status` | `text` | oui | `'ACTIVE'::text` |
| `source` | `text` | oui | — |
| `source_ref` | `text` | non | — |
| `license_note` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_vehicle_make_country_origin_check` : `CHECK (country_origin ~ '^[A-Z]{2}$'::text)`
- `catalog_vehicle_make_license_note_check` : `CHECK (btrim(license_note) <> ''::text AND length(license_note) <= 500)`
- `catalog_vehicle_make_name_check` : `CHECK (btrim(name) <> ''::text AND length(name) <= 80)`
- `catalog_vehicle_make_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_make_slug_check` : `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)`
- `catalog_vehicle_make_slug_key` : `UNIQUE (slug)`
- `catalog_vehicle_make_source_check` : `CHECK (source = ANY (ARRAY['WIKIDATA'::text, 'NHTSA_VPIC'::text, 'OPS_CURATED'::text, 'HOST_REQUEST'::text, 'DNIT_ADUANAS_PY'::text]))`
- `catalog_vehicle_make_source_ref_check` : `CHECK (source_ref IS NULL OR btrim(source_ref) <> ''::text)`
- `catalog_vehicle_make_status_check` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'PENDING_REVIEW'::text, 'RETIRED'::text]))`

Politiques RLS :

- `api_read` (SELECT, PERMISSIVE, app_api) USING `(status = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))`
- `catalog_addition_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((source = 'HOST_REQUEST'::text) AND (status = 'ACTIVE'::text))`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_make_no_delete` : `CREATE TRIGGER catalog_vehicle_make_no_delete BEFORE DELETE ON core.catalog_vehicle_make FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_make_no_truncate` : `CREATE TRIGGER catalog_vehicle_make_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_make FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle_model`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `make_id` | `uuid` | oui | — |
| `slug` | `text` | oui | — |
| `name` | `text` | oui | — |
| `aliases` | `text[]` | oui | `ARRAY[]::text[]` |
| `body_type` | `text` | non | — |
| `seats_default` | `smallint` | non | — |
| `doors_default` | `smallint` | non | — |
| `status` | `text` | oui | `'ACTIVE'::text` |
| `source` | `text` | oui | — |
| `source_ref` | `text` | non | — |
| `license_note` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_vehicle_model_body_type_check` : `CHECK (body_type = ANY (ARRAY['SUV'::text, 'PICKUP'::text, 'SEDAN'::text, 'HATCHBACK'::text, 'VAN'::text, 'MINIVAN'::text, 'COUPE'::text, 'CONVERTIBLE'::text, 'WAGON'::text]))`
- `catalog_vehicle_model_doors_default_check` : `CHECK (doors_default >= 1 AND doors_default <= 6)`
- `catalog_vehicle_model_license_note_check` : `CHECK (btrim(license_note) <> ''::text AND length(license_note) <= 500)`
- `catalog_vehicle_model_make_id_fkey` : `FOREIGN KEY (make_id) REFERENCES core.catalog_vehicle_make(id)`
- `catalog_vehicle_model_make_slug_key` : `UNIQUE (make_id, slug)`
- `catalog_vehicle_model_name_check` : `CHECK (btrim(name) <> ''::text AND length(name) <= 80)`
- `catalog_vehicle_model_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_model_seats_default_check` : `CHECK (seats_default >= 1 AND seats_default <= 60)`
- `catalog_vehicle_model_slug_check` : `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)`
- `catalog_vehicle_model_source_check` : `CHECK (source = ANY (ARRAY['WIKIDATA'::text, 'NHTSA_VPIC'::text, 'OPS_CURATED'::text, 'HOST_REQUEST'::text, 'DNIT_ADUANAS_PY'::text]))`
- `catalog_vehicle_model_source_ref_check` : `CHECK (source_ref IS NULL OR btrim(source_ref) <> ''::text)`
- `catalog_vehicle_model_specs_complete` : `CHECK (source = 'DNIT_ADUANAS_PY'::text OR body_type IS NOT NULL AND seats_default IS NOT NULL AND doors_default IS NOT NULL)`
- `catalog_vehicle_model_status_check` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'PENDING_REVIEW'::text, 'RETIRED'::text]))`

Politiques RLS :

- `api_read` (SELECT, PERMISSIVE, app_api) USING `(status = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))`
- `catalog_addition_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((source = 'HOST_REQUEST'::text) AND (status = 'ACTIVE'::text))`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_model_no_delete` : `CREATE TRIGGER catalog_vehicle_model_no_delete BEFORE DELETE ON core.catalog_vehicle_model FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_model_no_truncate` : `CREATE TRIGGER catalog_vehicle_model_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_model FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.catalog_vehicle_variant`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `model_id` | `uuid` | oui | — |
| `year_from` | `integer` | oui | — |
| `year_to` | `integer` | non | — |
| `trim_name` | `text` | non | — |
| `transmission` | `text` | non | — |
| `fuel_type` | `text` | non | — |
| `drive` | `text` | non | — |
| `engine_cc` | `integer` | non | — |
| `engine_cylinders` | `smallint` | non | — |
| `power_hp` | `integer` | non | — |
| `consumption_l_100km` | `numeric(3,1)` | non | — |
| `consumption_source` | `text` | non | — |
| `seats` | `smallint` | non | — |
| `doors` | `smallint` | non | — |
| `cargo_l` | `integer` | non | — |
| `value_class` | `text` | non | — |
| `market` | `character(2)` | non | — |
| `status` | `text` | oui | `'ACTIVE'::text` |
| `source` | `text` | oui | — |
| `source_ref` | `text` | non | — |
| `license_note` | `text` | oui | — |
| `verified_by` | `uuid` | non | — |
| `verified_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `catalog_vehicle_variant_cargo_l_check` : `CHECK (cargo_l >= 1 AND cargo_l <= 20000)`
- `catalog_vehicle_variant_check` : `CHECK (year_to IS NULL OR year_to >= year_from)`
- `catalog_vehicle_variant_consumption_l_100km_check` : `CHECK (consumption_l_100km > 0::numeric)`
- `catalog_vehicle_variant_consumption_source_check` : `CHECK (consumption_source = ANY (ARRAY['EPA_US_REFERENCE'::text, 'OPS_CURATED'::text]))`
- `catalog_vehicle_variant_consumption_sourced` : `CHECK ((consumption_l_100km IS NULL) = (consumption_source IS NULL))`
- `catalog_vehicle_variant_doors_check` : `CHECK (doors >= 1 AND doors <= 6)`
- `catalog_vehicle_variant_drive_check` : `CHECK (drive = ANY (ARRAY['FWD'::text, 'RWD'::text, 'AWD'::text, '4X4'::text]))`
- `catalog_vehicle_variant_engine_cc_check` : `CHECK (engine_cc >= 50 AND engine_cc <= 10000)`
- `catalog_vehicle_variant_engine_cylinders_check` : `CHECK (engine_cylinders >= 1 AND engine_cylinders <= 16)`
- `catalog_vehicle_variant_fuel_type_check` : `CHECK (fuel_type = ANY (ARRAY['GASOLINE'::text, 'DIESEL'::text, 'HYBRID'::text, 'PHEV'::text, 'EV'::text, 'LPG'::text]))`
- `catalog_vehicle_variant_license_note_check` : `CHECK (btrim(license_note) <> ''::text AND length(license_note) <= 500)`
- `catalog_vehicle_variant_market_fkey` : `FOREIGN KEY (market) REFERENCES core.config_country(code)`
- `catalog_vehicle_variant_model_id_fkey` : `FOREIGN KEY (model_id) REFERENCES core.catalog_vehicle_model(id)`
- `catalog_vehicle_variant_natural_key` : `UNIQUE NULLS NOT DISTINCT (model_id, year_from, trim_name, transmission, fuel_type, drive, market)`
- `catalog_vehicle_variant_pkey` : `PRIMARY KEY (id)`
- `catalog_vehicle_variant_power_hp_check` : `CHECK (power_hp >= 1 AND power_hp <= 2000)`
- `catalog_vehicle_variant_seats_check` : `CHECK (seats >= 1 AND seats <= 60)`
- `catalog_vehicle_variant_source_check` : `CHECK (source = ANY (ARRAY['WIKIDATA'::text, 'NHTSA_VPIC'::text, 'OPS_CURATED'::text, 'HOST_REQUEST'::text, 'DNIT_ADUANAS_PY'::text]))`
- `catalog_vehicle_variant_source_ref_check` : `CHECK (source_ref IS NULL OR btrim(source_ref) <> ''::text)`
- `catalog_vehicle_variant_specs_complete` : `CHECK (source = 'DNIT_ADUANAS_PY'::text OR transmission IS NOT NULL AND fuel_type IS NOT NULL AND drive IS NOT NULL AND seats IS NOT NULL AND doors IS NOT NULL)`
- `catalog_vehicle_variant_status_check` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'PENDING_REVIEW'::text, 'RETIRED'::text]))`
- `catalog_vehicle_variant_transmission_check` : `CHECK (transmission = ANY (ARRAY['MT'::text, 'AT'::text, 'CVT'::text, 'DCT'::text]))`
- `catalog_vehicle_variant_trim_name_check` : `CHECK (trim_name IS NULL OR btrim(trim_name) <> ''::text AND length(trim_name) <= 80)`
- `catalog_vehicle_variant_value_class_check` : `CHECK (value_class = ANY (ARRAY['STANDARD'::text, 'PREMIUM'::text, 'LUXE'::text]))`
- `catalog_vehicle_variant_verified_by_fkey` : `FOREIGN KEY (verified_by) REFERENCES core.iam_user_account(id)`
- `catalog_vehicle_variant_verified_pair` : `CHECK ((verified_by IS NULL) = (verified_at IS NULL))`
- `catalog_vehicle_variant_year_from_check` : `CHECK (year_from >= 1950 AND year_from <= 2100)`

Index :

- `catalog_vehicle_variant_model_idx` : `CREATE INDEX catalog_vehicle_variant_model_idx ON core.catalog_vehicle_variant USING btree (model_id, year_from)`

Politiques RLS :

- `api_read` (SELECT, PERMISSIVE, app_api) USING `(status = ANY (ARRAY['ACTIVE'::text, 'RETIRED'::text]))`
- `catalog_addition_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((source = 'HOST_REQUEST'::text) AND (status = 'ACTIVE'::text) AND (market IS NOT NULL) AND (verified_by IS NOT NULL) AND (verified_at IS NOT NULL))`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `catalog_vehicle_variant_no_delete` : `CREATE TRIGGER catalog_vehicle_variant_no_delete BEFORE DELETE ON core.catalog_vehicle_variant FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete()`
- `catalog_vehicle_variant_no_truncate` : `CREATE TRIGGER catalog_vehicle_variant_no_truncate BEFORE TRUNCATE ON core.catalog_vehicle_variant FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete()`

### `core.claim_damage_claim`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `case_id` | `uuid` | oui | — |
| `declared_by` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `declarant_user_id` | `uuid` | oui | — |
| `recorded_by` | `uuid` | oui | — |
| `recorded_role` | `text` | oui | — |
| `request_id` | `uuid` | oui | — |
| `description` | `text` | oui | — |
| `trip_end_at` | `timestamp with time zone` | oui | — |
| `deadline_at` | `timestamp with time zone` | oui | — |
| `reported_at` | `timestamp with time zone` | oui | `platform.now()` |
| `status` | `text` | oui | `'REPORTED'::text` |
| `decided_at` | `timestamp with time zone` | non | — |

Contraintes :

- `claim_damage_claim_case_fk` : `FOREIGN KEY (case_id) REFERENCES core.support_support_case(id)`
- `claim_damage_claim_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `claim_damage_claim_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `claim_damage_claim_deadline_after_end` : `CHECK (deadline_at >= trip_end_at)`
- `claim_damage_claim_decided_shape` : `CHECK ((status = 'DECIDED'::text) = (decided_at IS NOT NULL))`
- `claim_damage_claim_declarant_fk` : `FOREIGN KEY (declarant_user_id) REFERENCES core.iam_user_account(id)`
- `claim_damage_claim_declared_by_valid` : `CHECK (declared_by = ANY (ARRAY['HOST'::text, 'GUEST'::text]))`
- `claim_damage_claim_description_length` : `CHECK (char_length(description) >= 10 AND char_length(description) <= 1000)`
- `claim_damage_claim_in_time` : `CHECK (reported_at <= deadline_at)`
- `claim_damage_claim_kind_valid` : `CHECK (kind = ANY (ARRAY['DAMAGE'::text, 'INCIDENT'::text]))`
- `claim_damage_claim_pkey` : `PRIMARY KEY (id)`
- `claim_damage_claim_recorded_by_fk` : `FOREIGN KEY (recorded_by) REFERENCES core.iam_user_account(id)`
- `claim_damage_claim_request_unique` : `UNIQUE (request_id)`
- `claim_damage_claim_role_valid` : `CHECK (recorded_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text]))`
- `claim_damage_claim_status_valid` : `CHECK (status = ANY (ARRAY['REPORTED'::text, 'DECIDED'::text]))`
- `claim_damage_claim_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`

Index :

- `claim_damage_claim_live_unique` : `CREATE UNIQUE INDEX claim_damage_claim_live_unique ON core.claim_damage_claim USING btree (trip_id, declared_by, kind) WHERE (status = 'REPORTED'::text)`
- `claim_damage_claim_trip_idx` : `CREATE INDEX claim_damage_claim_trip_idx ON core.claim_damage_claim USING btree (trip_id)`

Politiques RLS :

- `cmd_money_claim_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = 'REPORTED'::text))`
- `cmd_money_claim_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_claim_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `(app.actor_kind() = 'STAFF'::text)` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = 'DECIDED'::text))`
- `iam_staff_claim_sel` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `claim_record_immutable` : `CREATE TRIGGER claim_record_immutable BEFORE DELETE OR UPDATE ON core.claim_damage_claim FOR EACH ROW EXECUTE FUNCTION core.claim_record_guard()`
- `claim_record_no_truncate` : `CREATE TRIGGER claim_record_no_truncate BEFORE TRUNCATE ON core.claim_damage_claim FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_record_immutable')`

### `core.claim_decision`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `claim_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `outcome` | `text` | oui | — |
| `covered` | `boolean` | oui | — |
| `repair_cost_minor` | `bigint` | oui | — |
| `charge_amount_minor` | `bigint` | oui | — |
| `leg_host_minor` | `bigint` | oui | — |
| `leg_insurer_minor` | `bigint` | oui | — |
| `leg_tax_third_party_minor` | `bigint` | oui | — |
| `leg_platform_minor` | `bigint` | oui | — |
| `host_deductible_minor` | `bigint` | oui | — |
| `guest_cap_minor` | `bigint` | non | — |
| `lines` | `jsonb` | oui | — |
| `excluded` | `jsonb` | oui | — |
| `evidence` | `jsonb` | oui | — |
| `facts` | `text` | oui | — |
| `guest_agreement_file_id` | `uuid` | non | — |
| `decided_by` | `uuid` | oui | — |
| `decided_role` | `text` | oui | — |
| `request_id` | `uuid` | oui | — |
| `decided_at` | `timestamp with time zone` | oui | `platform.now()` |
| `execution_status` | `text` | oui | — |
| `execution_code` | `text` | non | — |
| `charge_id` | `uuid` | non | — |
| `executed_at` | `timestamp with time zone` | non | — |
| `next_check_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `claim_decision_agreement_fk` : `FOREIGN KEY (guest_agreement_file_id) REFERENCES core.audit_file_asset(id)`
- `claim_decision_cap_nonneg` : `CHECK (guest_cap_minor IS NULL OR guest_cap_minor >= 0)`
- `claim_decision_caps` : `CHECK ((charge_amount_minor = 0 OR guest_cap_minor IS NOT NULL AND charge_amount_minor <= guest_cap_minor) AND (leg_host_minor + leg_insurer_minor) <= repair_cost_minor AND host_deductible_minor <= repair_cost_minor)`
- `claim_decision_charge_fk` : `FOREIGN KEY (charge_id) REFERENCES core.payment_post_trip_charge(id)`
- `claim_decision_charge_nonneg` : `CHECK (charge_amount_minor >= 0)`
- `claim_decision_claim_fk` : `FOREIGN KEY (claim_id) REFERENCES core.claim_damage_claim(id)`
- `claim_decision_claim_unique` : `UNIQUE (claim_id)`
- `claim_decision_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `claim_decision_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `claim_decision_decided_by_fk` : `FOREIGN KEY (decided_by) REFERENCES core.iam_user_account(id)`
- `claim_decision_deductible_nonneg` : `CHECK (host_deductible_minor >= 0)`
- `claim_decision_evidence_object` : `CHECK (jsonb_typeof(evidence) = 'object'::text)`
- `claim_decision_excluded_array` : `CHECK (jsonb_typeof(excluded) = 'array'::text)`
- `claim_decision_executed_shape` : `CHECK ((execution_status = 'DONE'::text) = (executed_at IS NOT NULL) AND (execution_status <> 'BLOCKED'::text OR execution_code IS NOT NULL))`
- `claim_decision_execution_code_format` : `CHECK (execution_code IS NULL OR execution_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `claim_decision_execution_valid` : `CHECK (execution_status = ANY (ARRAY['PENDING'::text, 'DONE'::text, 'BLOCKED'::text]))`
- `claim_decision_facts_length` : `CHECK (char_length(facts) >= 20 AND char_length(facts) <= 2000)`
- `claim_decision_host_nonneg` : `CHECK (leg_host_minor >= 0)`
- `claim_decision_insurer_nonneg` : `CHECK (leg_insurer_minor >= 0)`
- `claim_decision_legs_sum` : `CHECK ((leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor) = charge_amount_minor)`
- `claim_decision_lines_array` : `CHECK (jsonb_typeof(lines) = 'array'::text)`
- `claim_decision_outcome_shape` : `CHECK ((outcome = 'GUEST_LIABLE'::text) = (charge_amount_minor > 0) AND (outcome <> 'INELIGIBLE'::text OR NOT covered AND host_deductible_minor = 0) AND (host_deductible_minor = 0 OR covered))`
- `claim_decision_outcome_valid` : `CHECK (outcome = ANY (ARRAY['GUEST_LIABLE'::text, 'NO_GUEST_CHARGE'::text, 'INELIGIBLE'::text]))`
- `claim_decision_pkey` : `PRIMARY KEY (id)`
- `claim_decision_platform_nonneg` : `CHECK (leg_platform_minor >= 0)`
- `claim_decision_repair_nonneg` : `CHECK (repair_cost_minor >= 0)`
- `claim_decision_request_unique` : `UNIQUE (request_id)`
- `claim_decision_role_valid` : `CHECK (decided_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text]))`
- `claim_decision_tax_nonneg` : `CHECK (leg_tax_third_party_minor >= 0)`

Index :

- `claim_decision_due_idx` : `CREATE INDEX claim_decision_due_idx ON core.claim_decision USING btree (next_check_at) WHERE (execution_status = 'PENDING'::text)`
- `claim_decision_trip_idx` : `CREATE INDEX claim_decision_trip_idx ON core.claim_decision USING btree (trip_id)`

Politiques RLS :

- `cmd_money_claim_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `(app.actor_kind() = 'STAFF'::text)`
- `cmd_money_claim_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_claim_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `claim_record_immutable` : `CREATE TRIGGER claim_record_immutable BEFORE DELETE OR UPDATE ON core.claim_decision FOR EACH ROW EXECUTE FUNCTION core.claim_record_guard()`
- `claim_record_no_truncate` : `CREATE TRIGGER claim_record_no_truncate BEFORE TRUNCATE ON core.claim_decision FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_record_immutable')`

### `core.claim_evidence_bundle`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `case_id` | `uuid` | oui | — |
| `purpose` | `text` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `requested_role` | `text` | oui | — |
| `request_id` | `uuid` | oui | — |
| `status` | `text` | oui | `'REQUESTED'::text` |
| `manifest` | `jsonb` | oui | — |
| `manifest_sha256` | `bytea` | oui | — |
| `requested_at` | `timestamp with time zone` | oui | `platform.now()` |
| `generated_at` | `timestamp with time zone` | non | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `export_file_id` | `uuid` | non | — |
| `export_sha256` | `bytea` | non | — |
| `export_bytes` | `bigint` | non | — |
| `failure_code` | `text` | non | — |
| `findings` | `jsonb` | non | — |

Contraintes :

- `claim_evidence_bundle_case_id_fkey` : `FOREIGN KEY (case_id) REFERENCES core.support_support_case(id)`
- `claim_evidence_bundle_export_file_id_fkey` : `FOREIGN KEY (export_file_id) REFERENCES core.audit_file_asset(id)`
- `claim_evidence_bundle_pkey` : `PRIMARY KEY (id)`
- `claim_evidence_bundle_requested_by_fkey` : `FOREIGN KEY (requested_by) REFERENCES core.iam_user_account(id)`
- `claim_evidence_bundle_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `evidence_bundle_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `evidence_bundle_expiry_after_generation` : `CHECK (expires_at IS NULL OR expires_at > generated_at)`
- `evidence_bundle_export_bytes_positive` : `CHECK (export_bytes IS NULL OR export_bytes > 0)`
- `evidence_bundle_export_sha256_size` : `CHECK (export_sha256 IS NULL OR octet_length(export_sha256) = 32)`
- `evidence_bundle_failed_coherent` : `CHECK ((status = 'FAILED'::text) = (failure_code IS NOT NULL AND findings IS NOT NULL))`
- `evidence_bundle_failure_code_valid` : `CHECK (failure_code IS NULL OR (failure_code = ANY (ARRAY['INTEGRITY_MISMATCH'::text, 'OBJECT_MISSING'::text, 'KEY_UNAVAILABLE'::text, 'RENDER_FAILED'::text, 'TOO_LARGE'::text])))`
- `evidence_bundle_findings_array` : `CHECK (findings IS NULL OR jsonb_typeof(findings) = 'array'::text)`
- `evidence_bundle_manifest_object` : `CHECK (jsonb_typeof(manifest) = 'object'::text)`
- `evidence_bundle_manifest_sha256_size` : `CHECK (octet_length(manifest_sha256) = 32)`
- `evidence_bundle_purpose_valid` : `CHECK (purpose = ANY (ARRAY['ACODECO'::text, 'CHARGEBACK'::text, 'INSURER'::text, 'DISPUTE'::text]))`
- `evidence_bundle_ready_coherent` : `CHECK ((status = 'READY'::text) = (export_file_id IS NOT NULL AND export_sha256 IS NOT NULL AND export_bytes IS NOT NULL AND generated_at IS NOT NULL AND expires_at IS NOT NULL))`
- `evidence_bundle_request_unique` : `UNIQUE (request_id)`
- `evidence_bundle_role_format` : `CHECK (requested_role ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `evidence_bundle_status_valid` : `CHECK (status = ANY (ARRAY['REQUESTED'::text, 'READY'::text, 'FAILED'::text]))`
- `evidence_bundle_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`

Index :

- `evidence_bundle_due_idx` : `CREATE INDEX evidence_bundle_due_idx ON core.claim_evidence_bundle USING btree (requested_at) WHERE (status = 'REQUESTED'::text)`
- `evidence_bundle_trip_idx` : `CREATE INDEX evidence_bundle_trip_idx ON core.claim_evidence_bundle USING btree (trip_id, requested_at)`

Politiques RLS :

- `cmd_hold_evidence_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((status = 'REQUESTED'::text) AND (export_file_id IS NULL) AND (failure_code IS NULL))`
- `cmd_hold_evidence_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_evidence_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `true` WITH CHECK `(status = ANY (ARRAY['READY'::text, 'FAILED'::text]))`
- `iam_staff_evidence_sel` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `claim_evidence_no_truncate` : `CREATE TRIGGER claim_evidence_no_truncate BEFORE TRUNCATE ON core.claim_evidence_bundle FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_evidence_sealed')`
- `claim_evidence_sealed` : `CREATE TRIGGER claim_evidence_sealed BEFORE DELETE OR UPDATE ON core.claim_evidence_bundle FOR EACH ROW EXECUTE FUNCTION core.claim_evidence_guard()`

### `core.claim_incidental_host_file`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `file_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `uploader_user_id` | `uuid` | oui | — |
| `sha256` | `bytea` | oui | — |
| `received_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `claim_incidental_host_file_asset_fk` : `FOREIGN KEY (file_id) REFERENCES core.audit_file_asset(id)`
- `claim_incidental_host_file_pkey` : `PRIMARY KEY (file_id)`
- `claim_incidental_host_file_sha_length` : `CHECK (length(sha256) = 32)`
- `claim_incidental_host_file_trip_fk` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `claim_incidental_host_file_user_fk` : `FOREIGN KEY (uploader_user_id) REFERENCES core.iam_user_account(id)`

Index :

- `claim_incidental_host_file_sha_unique` : `CREATE UNIQUE INDEX claim_incidental_host_file_sha_unique ON core.claim_incidental_host_file USING btree (sha256)`
- `claim_incidental_host_file_trip_idx` : `CREATE INDEX claim_incidental_host_file_trip_idx ON core.claim_incidental_host_file USING btree (trip_id)`

Politiques RLS :

- `cmd_hold_incidental_file_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `true`
- `cmd_hold_incidental_file_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `claim_incidental_host_file_immutable` : `CREATE TRIGGER claim_incidental_host_file_immutable BEFORE DELETE OR UPDATE ON core.claim_incidental_host_file FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('claim_incidental_host_file_immutable')`
- `claim_incidental_host_file_no_truncate` : `CREATE TRIGGER claim_incidental_host_file_no_truncate BEFORE TRUNCATE ON core.claim_incidental_host_file FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_incidental_host_file_immutable')`

### `core.claim_incidental_invoice`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `org_id` | `uuid` | oui | — |
| `host_user_id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `request_id` | `uuid` | oui | — |
| `fee_type` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `leg_host_minor` | `bigint` | oui | — |
| `leg_insurer_minor` | `bigint` | oui | — |
| `leg_tax_third_party_minor` | `bigint` | oui | — |
| `leg_platform_minor` | `bigint` | oui | — |
| `description` | `text` | oui | — |
| `evidence_file_ids` | `uuid[]` | oui | — |
| `trip_end_at` | `timestamp with time zone` | oui | — |
| `host_deadline_at` | `timestamp with time zone` | oui | — |
| `notified_at` | `timestamp with time zone` | oui | `platform.now()` |
| `response_hours` | `integer` | oui | — |
| `response_due_at` | `timestamp with time zone` | oui | — |
| `status` | `text` | oui | `'AWAITING_GUEST'::text` |
| `accepted_at` | `timestamp with time zone` | non | — |
| `disputed_at` | `timestamp with time zone` | non | — |
| `dispute_reason` | `text` | non | — |
| `dispute_evidence_file_ids` | `uuid[]` | non | — |
| `decided_at` | `timestamp with time zone` | non | — |
| `decided_by` | `uuid` | non | — |
| `decided_role` | `text` | non | — |
| `decision_request_id` | `uuid` | non | — |
| `decision_rationale` | `text` | non | — |
| `cancelled_at` | `timestamp with time zone` | non | — |
| `charge_basis` | `text` | non | — |
| `charge_id` | `uuid` | non | — |
| `charged_at` | `timestamp with time zone` | non | — |
| `next_check_at` | `timestamp with time zone` | oui | — |
| `execution_code` | `text` | non | — |
| `defer_count` | `integer` | oui | `0` |
| `review_required_at` | `timestamp with time zone` | non | — |

Contraintes :

- `claim_incidental_amount_positive` : `CHECK (amount_minor > 0)`
- `claim_incidental_charge_after_window` : `CHECK (charge_basis IS NULL OR charge_basis = 'GUEST_ACCEPTED'::text AND accepted_at IS NOT NULL AND charged_at >= accepted_at OR charge_basis = 'NO_RESPONSE'::text AND accepted_at IS NULL AND disputed_at IS NULL AND charged_at >= response_due_at OR charge_basis = 'OPS_DECISION'::text AND decided_at IS NOT NULL AND decided_role = 'ADMIN'::text AND charged_at >= decided_at)`
- `claim_incidental_charge_basis_valid` : `CHECK (charge_basis IS NULL OR (charge_basis = ANY (ARRAY['GUEST_ACCEPTED'::text, 'NO_RESPONSE'::text, 'OPS_DECISION'::text])))`
- `claim_incidental_charge_fk` : `FOREIGN KEY (charge_id) REFERENCES core.payment_post_trip_charge(id)`
- `claim_incidental_charge_unique` : `UNIQUE (charge_id)`
- `claim_incidental_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `claim_incidental_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `claim_incidental_deadlines` : `CHECK (host_deadline_at >= trip_end_at AND notified_at <= host_deadline_at AND response_due_at = (notified_at + make_interval(hours => response_hours)))`
- `claim_incidental_decided_by_fk` : `FOREIGN KEY (decided_by) REFERENCES core.iam_user_account(id)`
- `claim_incidental_decided_role_valid` : `CHECK (decided_role IS NULL OR (decided_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text])))`
- `claim_incidental_decision_request_unique` : `UNIQUE (decision_request_id)`
- `claim_incidental_decision_shape` : `CHECK ((decided_at IS NULL) = (decided_by IS NULL) AND (decided_at IS NULL) = (decided_role IS NULL) AND (decided_at IS NULL) = (decision_request_id IS NULL) AND (decided_at IS NULL) = (decision_rationale IS NULL) AND (decided_at IS NULL OR disputed_at IS NOT NULL AND decided_at >= disputed_at))`
- `claim_incidental_defer_count_range` : `CHECK (defer_count >= 0 AND defer_count <= 12)`
- `claim_incidental_description_length` : `CHECK (char_length(description) >= 10 AND char_length(description) <= 500)`
- `claim_incidental_dispute_evidence_shape` : `CHECK (dispute_evidence_file_ids IS NULL OR cardinality(dispute_evidence_file_ids) >= 1 AND cardinality(dispute_evidence_file_ids) <= 10 AND array_position(dispute_evidence_file_ids, NULL::uuid) IS NULL)`
- `claim_incidental_dispute_reason_length` : `CHECK (dispute_reason IS NULL OR char_length(dispute_reason) >= 20 AND char_length(dispute_reason) <= 1000)`
- `claim_incidental_dispute_shape` : `CHECK ((disputed_at IS NULL) = (dispute_reason IS NULL) AND (disputed_at IS NULL) = (dispute_evidence_file_ids IS NULL))`
- `claim_incidental_evidence_shape` : `CHECK (cardinality(evidence_file_ids) >= 1 AND cardinality(evidence_file_ids) <= 10 AND array_position(evidence_file_ids, NULL::uuid) IS NULL)`
- `claim_incidental_execution_code_format` : `CHECK (execution_code IS NULL OR execution_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `claim_incidental_fee_type_valid` : `CHECK (fee_type = ANY (ARRAY['FUEL'::text, 'CLEANING'::text, 'SMOKING'::text]))`
- `claim_incidental_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `claim_incidental_host_fk` : `FOREIGN KEY (host_user_id) REFERENCES core.iam_user_account(id)`
- `claim_incidental_invoice_pkey` : `PRIMARY KEY (id)`
- `claim_incidental_legs_host_only` : `CHECK (leg_host_minor = amount_minor AND leg_insurer_minor = 0 AND leg_tax_third_party_minor = 0 AND leg_platform_minor = 0)`
- `claim_incidental_rationale_length` : `CHECK (decision_rationale IS NULL OR char_length(decision_rationale) >= 20 AND char_length(decision_rationale) <= 2000)`
- `claim_incidental_request_unique` : `UNIQUE (request_id)`
- `claim_incidental_response_hours_range` : `CHECK (response_hours >= 1 AND response_hours <= 720)`
- `claim_incidental_response_in_window` : `CHECK ((accepted_at IS NULL OR accepted_at >= notified_at AND accepted_at < response_due_at) AND (disputed_at IS NULL OR disputed_at >= notified_at AND disputed_at < response_due_at) AND (accepted_at IS NULL OR disputed_at IS NULL))`
- `claim_incidental_review_shape` : `CHECK (review_required_at IS NULL OR defer_count = 12)`
- `claim_incidental_status_shape` : `CHECK ((status <> 'ACCEPTED'::text OR accepted_at IS NOT NULL) AND (status <> 'DISPUTED'::text OR disputed_at IS NOT NULL AND decided_at IS NULL) AND ((status <> ALL (ARRAY['DECIDED_CHARGE'::text, 'REJECTED'::text])) OR decided_at IS NOT NULL) AND (status = 'CANCELLED_BY_HOST'::text) = (cancelled_at IS NOT NULL) AND (status = 'CHARGED'::text) = (charge_id IS NOT NULL) AND (status = 'CHARGED'::text) = (charged_at IS NOT NULL) AND (status = 'CHARGED'::text) = (charge_basis IS NOT NULL))`
- `claim_incidental_status_valid` : `CHECK (status = ANY (ARRAY['AWAITING_GUEST'::text, 'ACCEPTED'::text, 'DISPUTED'::text, 'DECIDED_CHARGE'::text, 'CHARGED'::text, 'REJECTED'::text, 'CANCELLED_BY_HOST'::text]))`
- `claim_incidental_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`

Index :

- `claim_incidental_due_idx` : `CREATE INDEX claim_incidental_due_idx ON core.claim_incidental_invoice USING btree (next_check_at) WHERE ((status = ANY (ARRAY['AWAITING_GUEST'::text, 'ACCEPTED'::text, 'DECIDED_CHARGE'::text])) AND (review_required_at IS NULL))`
- `claim_incidental_live_unique` : `CREATE UNIQUE INDEX claim_incidental_live_unique ON core.claim_incidental_invoice USING btree (trip_id, fee_type) WHERE (status <> 'CANCELLED_BY_HOST'::text)`
- `claim_incidental_trip_idx` : `CREATE INDEX claim_incidental_trip_idx ON core.claim_incidental_invoice USING btree (trip_id)`

Politiques RLS :

- `cmd_money_incidental_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'HOST'::text) AND (host_user_id = app.actor_id()) AND (status = 'AWAITING_GUEST'::text))`
- `cmd_money_incidental_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_incidental_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `(((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id())) OR ((app.actor_kind() = 'HOST'::text) AND (host_user_id = app.actor_id())) OR (app.actor_kind() = 'STAFF'::text) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text)))` WITH CHECK `(((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()) AND (status = ANY (ARRAY['ACCEPTED'::text, 'DISPUTED'::text]))) OR ((app.actor_kind() = 'HOST'::text) AND (host_user_id = app.actor_id()) AND (status = 'CANCELLED_BY_HOST'::text)) OR ((app.actor_kind() = 'STAFF'::text) AND (status = ANY (ARRAY['DECIDED_CHARGE'::text, 'REJECTED'::text]))) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = ANY (ARRAY['AWAITING_GUEST'::text, 'ACCEPTED'::text, 'DECIDED_CHARGE'::text, 'CHARGED'::text]))))`
- `iam_staff_incidental_sel` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `claim_incidental_immutable` : `CREATE TRIGGER claim_incidental_immutable BEFORE DELETE OR UPDATE ON core.claim_incidental_invoice FOR EACH ROW EXECUTE FUNCTION core.claim_incidental_guard()`
- `claim_incidental_no_truncate` : `CREATE TRIGGER claim_incidental_no_truncate BEFORE TRUNCATE ON core.claim_incidental_invoice FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_incidental_immutable')`

### `core.claim_insurer_declaration`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `decision_id` | `uuid` | oui | — |
| `claim_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `recorded_at` | `timestamp with time zone` | oui | `platform.now()` |
| `sent_at` | `timestamp with time zone` | non | — |
| `provider_ref` | `text` | non | — |

Contraintes :

- `claim_insurer_declaration_claim_fk` : `FOREIGN KEY (claim_id) REFERENCES core.claim_damage_claim(id)`
- `claim_insurer_declaration_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `claim_insurer_declaration_decision_fk` : `FOREIGN KEY (decision_id) REFERENCES core.claim_decision(id)`
- `claim_insurer_declaration_decision_unique` : `UNIQUE (decision_id)`
- `claim_insurer_declaration_pkey` : `PRIMARY KEY (id)`
- `claim_insurer_declaration_ref_format` : `CHECK (provider_ref IS NULL OR provider_ref ~ '^[A-Za-z0-9:._-]{1,100}$'::text)`
- `claim_insurer_declaration_sent_shape` : `CHECK ((status = 'SENT'::text) = (sent_at IS NOT NULL) AND (status = 'SENT'::text) = (provider_ref IS NOT NULL))`
- `claim_insurer_declaration_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'SENT'::text]))`

Politiques RLS :

- `cmd_money_claim_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'PENDING'::text))`
- `cmd_money_claim_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_claim_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `claim_record_immutable` : `CREATE TRIGGER claim_record_immutable BEFORE DELETE OR UPDATE ON core.claim_insurer_declaration FOR EACH ROW EXECUTE FUNCTION core.claim_record_guard()`
- `claim_record_no_truncate` : `CREATE TRIGGER claim_record_no_truncate BEFORE TRUNCATE ON core.claim_insurer_declaration FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_record_immutable')`

### `core.config_brand_asset`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `file_asset_id` | `uuid` | oui | — |
| `storage_key` | `text` | oui | — |
| `mime` | `text` | oui | — |
| `bytes` | `bigint` | oui | — |
| `sha256` | `bytea` | oui | — |
| `alt_text_es` | `text` | non | — |
| `alt_text_en` | `text` | non | — |
| `alt_text_fr` | `text` | non | — |
| `license_note` | `text` | oui | — |
| `uploaded_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `request_id` | `uuid` | oui | — |
| `alt_text_pt` | `text` | non | — |

Contraintes :

- `brand_asset_alt_all_locales` : `CHECK (COALESCE(kind = 'FONT'::text OR char_length(btrim(alt_text_es)) >= 1 AND char_length(btrim(alt_text_es)) <= 300 AND char_length(btrim(alt_text_en)) >= 1 AND char_length(btrim(alt_text_en)) <= 300 AND char_length(btrim(alt_text_fr)) >= 1 AND char_length(btrim(alt_text_fr)) <= 300 AND char_length(btrim(alt_text_pt)) >= 1 AND char_length(btrim(alt_text_pt)) <= 300, false))`
- `brand_asset_bytes_valid` : `CHECK (bytes >= 1 AND bytes <= 10485760)`
- `brand_asset_file_unique` : `UNIQUE (file_asset_id)`
- `brand_asset_kind_valid` : `CHECK (kind = ANY (ARRAY['LOGO'::text, 'FAVICON'::text, 'PWA_ICON'::text, 'HERO_IMAGE'::text, 'FONT'::text]))`
- `brand_asset_license_length` : `CHECK (char_length(btrim(license_note)) >= 3 AND char_length(btrim(license_note)) <= 1000)`
- `brand_asset_mime_valid` : `CHECK (kind = 'FONT'::text AND mime = 'font/woff2'::text OR kind <> 'FONT'::text AND (mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text])))`
- `brand_asset_pkey` : `PRIMARY KEY (id)`
- `brand_asset_request_unique` : `UNIQUE (request_id)`
- `brand_asset_sha256_size` : `CHECK (octet_length(sha256) = 32)`
- `brand_asset_storage_key_format` : `CHECK (storage_key ~ '^brand/[0-9a-f-]{36}$'::text)`
- `config_brand_asset_file_asset_id_fkey` : `FOREIGN KEY (file_asset_id) REFERENCES core.audit_file_asset(id)`
- `config_brand_asset_uploaded_by_fkey` : `FOREIGN KEY (uploaded_by) REFERENCES core.iam_user_account(id)`

Politiques RLS :

- `api_read_published` (SELECT, PERMISSIVE, app_api) USING `((EXISTS ( SELECT 1 FROM core.config_brand_version v WHERE ((v.status = 'PUBLISHED'::text) AND (((config_brand_asset.id = v.logo_asset_id) OR (config_brand_asset.id = v.favicon_asset_id)) OR (config_brand_asset.id = v.pwa_icon_asset_id))))) OR (EXISTS ( SELECT 1 FROM core.config_content_block b WHERE ((b.status = 'PUBLISHED'::text) AND (b.asset_id = config_brand_asset.id)))))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `brand_asset_immutable` : `CREATE TRIGGER brand_asset_immutable BEFORE DELETE OR UPDATE ON core.config_brand_asset FOR EACH ROW EXECUTE FUNCTION core.cfg_brand_asset_guard()`
- `brand_asset_no_truncate` : `CREATE TRIGGER brand_asset_no_truncate BEFORE TRUNCATE ON core.config_brand_asset FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate()`

### `core.config_brand_version`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `version_no` | `integer` | oui | — |
| `status` | `text` | oui | — |
| `brand_name` | `text` | oui | — |
| `tokens` | `jsonb` | oui | — |
| `tokens_schema_version` | `integer` | oui | — |
| `logo_asset_id` | `uuid` | non | — |
| `favicon_asset_id` | `uuid` | non | — |
| `pwa_icon_asset_id` | `uuid` | non | — |
| `email_skin` | `jsonb` | non | — |
| `whatsapp_skin` | `jsonb` | non | — |
| `contrast_check` | `jsonb` | non | — |
| `copied_from_id` | `uuid` | non | — |
| `created_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `published_by` | `uuid` | non | — |
| `published_at` | `timestamp with time zone` | non | — |
| `archived_at` | `timestamp with time zone` | non | — |
| `request_id` | `uuid` | oui | — |

Contraintes :

- `brand_version_archive_complete` : `CHECK ((status = 'ARCHIVED'::text) = (archived_at IS NOT NULL))`
- `brand_version_contrast_passed` : `CHECK (COALESCE(status = 'DRAFT'::text OR core.cfg_brand_contrast_valid(contrast_check) AND (contrast_check ->> 'tokensSha256'::text) = core.cfg_brand_tokens_sha256(tokens), false))`
- `brand_version_email_skin_object` : `CHECK (email_skin IS NULL OR jsonb_typeof(email_skin) = 'object'::text)`
- `brand_version_name_valid` : `CHECK (char_length(btrim(brand_name)) >= 1 AND char_length(btrim(brand_name)) <= 60 AND brand_name !~ '[[:cntrl:]<>{}]'::text)`
- `brand_version_no_positive` : `CHECK (version_no > 0)`
- `brand_version_no_unique` : `UNIQUE (version_no)`
- `brand_version_pkey` : `PRIMARY KEY (id)`
- `brand_version_publication_complete` : `CHECK ((status = 'DRAFT'::text) = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL))`
- `brand_version_request_unique` : `UNIQUE (request_id)`
- `brand_version_schema_positive` : `CHECK (tokens_schema_version > 0)`
- `brand_version_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))`
- `brand_version_tokens_object` : `CHECK (jsonb_typeof(tokens) = 'object'::text AND octet_length(tokens::text) <= 131072)`
- `brand_version_whatsapp_skin_object` : `CHECK (whatsapp_skin IS NULL OR jsonb_typeof(whatsapp_skin) = 'object'::text)`
- `config_brand_version_copied_from_id_fkey` : `FOREIGN KEY (copied_from_id) REFERENCES core.config_brand_version(id)`
- `config_brand_version_created_by_fkey` : `FOREIGN KEY (created_by) REFERENCES core.iam_user_account(id)`
- `config_brand_version_favicon_asset_id_fkey` : `FOREIGN KEY (favicon_asset_id) REFERENCES core.config_brand_asset(id)`
- `config_brand_version_logo_asset_id_fkey` : `FOREIGN KEY (logo_asset_id) REFERENCES core.config_brand_asset(id)`
- `config_brand_version_published_by_fkey` : `FOREIGN KEY (published_by) REFERENCES core.iam_user_account(id)`
- `config_brand_version_pwa_icon_asset_id_fkey` : `FOREIGN KEY (pwa_icon_asset_id) REFERENCES core.config_brand_asset(id)`

Index :

- `brand_version_one_published` : `CREATE UNIQUE INDEX brand_version_one_published ON core.config_brand_version USING btree ((true)) WHERE (status = 'PUBLISHED'::text)`

Politiques RLS :

- `api_read_published` (SELECT, PERMISSIVE, app_api) USING `(status = 'PUBLISHED'::text)`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(status = 'DRAFT'::text)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text]))` WITH CHECK `(status = ANY (ARRAY['PUBLISHED'::text, 'ARCHIVED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `brand_version_immutable` : `CREATE TRIGGER brand_version_immutable BEFORE INSERT OR DELETE OR UPDATE ON core.config_brand_version FOR EACH ROW EXECUTE FUNCTION core.cfg_brand_version_guard()`
- `brand_version_no_truncate` : `CREATE TRIGGER brand_version_no_truncate BEFORE TRUNCATE ON core.config_brand_version FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate()`

### `core.config_content_block`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `block_key` | `text` | oui | — |
| `locale` | `text` | oui | — |
| `country_code` | `character(2)` | non | — |
| `version_no` | `integer` | oui | — |
| `status` | `text` | oui | — |
| `body_md` | `text` | oui | — |
| `asset_id` | `uuid` | non | — |
| `copied_from_id` | `uuid` | non | — |
| `created_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `published_by` | `uuid` | non | — |
| `published_at` | `timestamp with time zone` | non | — |
| `archived_at` | `timestamp with time zone` | non | — |
| `request_id` | `uuid` | oui | — |

Contraintes :

- `config_content_block_asset_id_fkey` : `FOREIGN KEY (asset_id) REFERENCES core.config_brand_asset(id)`
- `config_content_block_copied_from_id_fkey` : `FOREIGN KEY (copied_from_id) REFERENCES core.config_content_block(id)`
- `config_content_block_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_content_block_created_by_fkey` : `FOREIGN KEY (created_by) REFERENCES core.iam_user_account(id)`
- `config_content_block_published_by_fkey` : `FOREIGN KEY (published_by) REFERENCES core.iam_user_account(id)`
- `content_block_archive_complete` : `CHECK ((status = 'ARCHIVED'::text) = (archived_at IS NOT NULL))`
- `content_block_body_allowed` : `CHECK (core.cfg_brand_body_allowed(body_md))`
- `content_block_key_format` : `CHECK (block_key ~ '^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,39}){1,5}$'::text AND char_length(block_key) <= 120)`
- `content_block_key_not_legal` : `CHECK (block_key !~ '^legal\.'::text)`
- `content_block_key_not_legal_text` : `CHECK (core.cfg_content_key_not_legal(block_key))`
- `content_block_locale_valid` : `CHECK (locale = ANY (ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `content_block_pkey` : `PRIMARY KEY (id)`
- `content_block_publication_complete` : `CHECK ((status = 'DRAFT'::text) = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL))`
- `content_block_request_unique` : `UNIQUE (request_id, locale)`
- `content_block_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))`
- `content_block_version_positive` : `CHECK (version_no > 0)`
- `content_block_version_unique` : `UNIQUE NULLS NOT DISTINCT (block_key, country_code, version_no, locale)`

Index :

- `content_block_one_published` : `CREATE UNIQUE INDEX content_block_one_published ON core.config_content_block USING btree (block_key, locale, country_code) NULLS NOT DISTINCT WHERE (status = 'PUBLISHED'::text)`

Politiques RLS :

- `api_read_published` (SELECT, PERMISSIVE, app_api) USING `(status = 'PUBLISHED'::text)`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(status = 'DRAFT'::text)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text]))` WITH CHECK `(status = ANY (ARRAY['PUBLISHED'::text, 'ARCHIVED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `content_block_immutable` : `CREATE TRIGGER content_block_immutable BEFORE INSERT OR DELETE OR UPDATE ON core.config_content_block FOR EACH ROW EXECUTE FUNCTION core.cfg_content_block_guard()`
- `content_block_no_truncate` : `CREATE TRIGGER content_block_no_truncate BEFORE TRUNCATE ON core.config_content_block FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate()`

### `core.config_country`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `character(2)` | oui | — |
| `currency` | `character(3)` | oui | — |
| `time_zone` | `text` | oui | — |
| `legal_locale` | `text` | oui | — |
| `default_locale` | `text` | oui | — |
| `locales` | `text[]` | oui | — |
| `names` | `jsonb` | oui | — |
| `host_tax_id_kinds` | `text[]` | oui | — |

Contraintes :

- `config_country_check` : `CHECK (legal_locale = ANY (locales))`
- `config_country_check1` : `CHECK (default_locale = ANY (locales))`
- `config_country_code_check` : `CHECK (code ~ '^[A-Z]{2}$'::text)`
- `config_country_currency_fkey` : `FOREIGN KEY (currency) REFERENCES core.config_currency(code)`
- `config_country_locales_check` : `CHECK (cardinality(locales) > 0)`
- `config_country_names_check` : `CHECK (jsonb_typeof(names) = 'object'::text)`
- `config_country_pkey` : `PRIMARY KEY (code)`
- `config_country_time_zone_check` : `CHECK (time_zone <> ''::text)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_hold_country_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_limit_select` (SELECT, PERMISSIVE, risk_limit_owner) USING `true`

Déclencheurs :

- `config_country_guard` : `CREATE TRIGGER config_country_guard BEFORE DELETE OR UPDATE ON core.config_country FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_country_no_truncate` : `CREATE TRIGGER config_country_no_truncate BEFORE TRUNCATE ON core.config_country FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_currency`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `character(3)` | oui | — |
| `exponent` | `smallint` | oui | — |

Contraintes :

- `config_currency_code_check` : `CHECK (code ~ '^[A-Z]{3}$'::text)`
- `config_currency_exponent_check` : `CHECK (exponent >= 0 AND exponent <= 18)`
- `config_currency_pkey` : `PRIMARY KEY (code)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_currency_guard` : `CREATE TRIGGER config_currency_guard BEFORE DELETE OR UPDATE ON core.config_currency FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_currency_no_truncate` : `CREATE TRIGGER config_currency_no_truncate BEFORE TRUNCATE ON core.config_currency FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_go_live_switch_request`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_golive_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `key` | `text` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `value` | `boolean` | oui | — |
| `decision_ref` | `text` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `requested_at` | `timestamp with time zone` | oui | `platform.now()` |
| `expires_at` | `timestamp with time zone` | oui | — |
| `approved_by` | `uuid` | non | — |
| `approved_at` | `timestamp with time zone` | non | — |
| `status` | `text` | oui | — |

Contraintes :

- `config_go_live_switch_request_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_go_live_switch_request_key_fkey` : `FOREIGN KEY (key) REFERENCES core.config_param_definition(key)`
- `config_go_live_switch_request_pkey` : `PRIMARY KEY (id)`
- `go_live_request_applied_shape` : `CHECK ((status = 'APPLIED'::text) = (approved_by IS NOT NULL))`
- `go_live_request_approved_at` : `CHECK ((approved_by IS NULL) = (approved_at IS NULL))`
- `go_live_request_decision_ref_format` : `CHECK (decision_ref ~ '^DEC-FONDATEUR-[0-9]{1,4}$'::text)`
- `go_live_request_expiry` : `CHECK (expires_at > requested_at)`
- `go_live_request_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'APPLIED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'SUPERSEDED'::text, 'CANCELLED'::text]))`
- `go_live_request_two_people` : `CHECK (approved_by IS NULL OR approved_by <> requested_by)`

Index :

- `go_live_request_one_pending` : `CREATE UNIQUE INDEX go_live_request_one_pending ON core.config_go_live_switch_request USING btree (key, country_code) WHERE (status = 'PENDING'::text)`

Politiques RLS :

- `cmd_golive_ins` (INSERT, PERMISSIVE, cmd_golive_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text) AND (approved_by IS NULL) AND ((country_code)::text = ANY (app.country_scope())))`
- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_golive_upd` (UPDATE, PERMISSIVE, cmd_golive_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = ANY (ARRAY['APPLIED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'SUPERSEDED'::text, 'CANCELLED'::text])) AND ((country_code)::text = ANY (app.country_scope())))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `go_live_request_guard` : `CREATE TRIGGER go_live_request_guard BEFORE DELETE OR UPDATE ON core.config_go_live_switch_request FOR EACH ROW EXECUTE FUNCTION core.config_go_live_request_guard()`
- `go_live_request_no_truncate` : `CREATE TRIGGER go_live_request_no_truncate BEFORE TRUNCATE ON core.config_go_live_switch_request FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_holiday_calendar`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `country_code` | `character(2)` | oui | — |
| `date` | `date` | oui | — |
| `name` | `text` | oui | — |
| `version` | `integer` | oui | — |

Contraintes :

- `config_holiday_calendar_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_holiday_calendar_name_check` : `CHECK (name <> ''::text)`
- `config_holiday_calendar_pkey` : `PRIMARY KEY (country_code, date, version)`
- `config_holiday_calendar_version_check` : `CHECK (version > 0)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `cmd_money_payout_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_holiday_calendar_guard` : `CREATE TRIGGER config_holiday_calendar_guard BEFORE DELETE OR UPDATE ON core.config_holiday_calendar FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_holiday_calendar_no_truncate` : `CREATE TRIGGER config_holiday_calendar_no_truncate BEFORE TRUNCATE ON core.config_holiday_calendar FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_param_bound`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_param_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `key` | `text` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `min_value` | `numeric` | oui | — |
| `max_value` | `numeric` | oui | — |
| `source_ref` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `name` | oui | `CURRENT_USER` |

Contraintes :

- `config_param_bound_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_param_bound_key_fkey` : `FOREIGN KEY (key) REFERENCES core.config_param_definition(key)`
- `config_param_bound_pkey` : `PRIMARY KEY (key, country_code)`
- `param_bound_max_integral` : `CHECK (max_value = trunc(max_value))`
- `param_bound_min_integral` : `CHECK (min_value = trunc(min_value) AND min_value >= 0::numeric)`
- `param_bound_order` : `CHECK (min_value <= max_value)`
- `param_bound_source_ref` : `CHECK (source_ref <> ''::text)`

Politiques RLS :

- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_param_bound_guard` : `CREATE TRIGGER config_param_bound_guard BEFORE DELETE OR UPDATE ON core.config_param_bound FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_param_bound_insert_guard` : `CREATE TRIGGER config_param_bound_insert_guard BEFORE INSERT ON core.config_param_bound FOR EACH ROW EXECUTE FUNCTION core.config_param_bound_guard()`
- `config_param_bound_no_truncate` : `CREATE TRIGGER config_param_bound_no_truncate BEFORE TRUNCATE ON core.config_param_bound FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_param_change_request`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_param_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `key` | `text` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `value` | `jsonb` | oui | — |
| `currency` | `character(3)` | non | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `reason` | `text` | oui | — |
| `decision_ref` | `text` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `requested_at` | `timestamp with time zone` | oui | `platform.now()` |
| `expires_at` | `timestamp with time zone` | oui | — |
| `approved_by` | `uuid` | non | — |
| `approved_at` | `timestamp with time zone` | non | — |
| `status` | `text` | oui | — |

Contraintes :

- `config_param_change_request_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_param_change_request_currency_fkey` : `FOREIGN KEY (currency) REFERENCES core.config_currency(code)`
- `config_param_change_request_key_fkey` : `FOREIGN KEY (key) REFERENCES core.config_param_definition(key)`
- `config_param_change_request_pkey` : `PRIMARY KEY (id)`
- `param_change_request_applied_shape` : `CHECK ((status = 'APPLIED'::text) = (approved_by IS NOT NULL))`
- `param_change_request_approved_at` : `CHECK ((approved_by IS NULL) = (approved_at IS NULL))`
- `param_change_request_decision_ref_format` : `CHECK (decision_ref ~ '^DEC-FONDATEUR-[0-9]{1,4}$'::text)`
- `param_change_request_expiry` : `CHECK (expires_at > requested_at)`
- `param_change_request_not_retroactive` : `CHECK (valid_from >= requested_at)`
- `param_change_request_reason_length` : `CHECK (char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 1000)`
- `param_change_request_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'APPLIED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'CANCELLED'::text]))`
- `param_change_request_two_people` : `CHECK (approved_by IS NULL OR approved_by <> requested_by)`

Index :

- `param_change_request_one_pending` : `CREATE UNIQUE INDEX param_change_request_one_pending ON core.config_param_change_request USING btree (key, country_code) WHERE (status = 'PENDING'::text)`

Politiques RLS :

- `cmd_param_ins` (INSERT, PERMISSIVE, cmd_param_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text) AND (approved_by IS NULL) AND ((country_code)::text = ANY (app.country_scope())))`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `cmd_param_upd` (UPDATE, PERMISSIVE, cmd_param_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = ANY (ARRAY['APPLIED'::text, 'REJECTED'::text, 'EXPIRED'::text, 'CANCELLED'::text])) AND ((country_code)::text = ANY (app.country_scope())))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `param_change_request_guard` : `CREATE TRIGGER param_change_request_guard BEFORE INSERT OR DELETE OR UPDATE ON core.config_param_change_request FOR EACH ROW EXECUTE FUNCTION core.config_param_change_request_guard()`
- `param_change_request_no_truncate` : `CREATE TRIGGER param_change_request_no_truncate BEFORE TRUNCATE ON core.config_param_change_request FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_param_definition`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_golive_owner: SELECT ; cmd_money_owner: SELECT ; cmd_param_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `key` | `text` | oui | — |
| `type` | `text` | oui | — |
| `unit` | `text` | non | — |
| `allowed_scopes` | `text[]` | oui | — |
| `currency_bound` | `boolean` | oui | `false` |
| `fail_mode` | `text` | oui | — |
| `optional` | `boolean` | oui | `false` |
| `go_live_switch` | `boolean` | oui | `false` |
| `not_applicable_in` | `text[]` | oui | `'{}'::text[]` |
| `allowed_values` | `text[]` | non | — |
| `source_ref` | `text` | oui | — |
| `status` | `text` | oui | — |

Contraintes :

- `config_param_definition_allowed_scopes_check` : `CHECK (cardinality(allowed_scopes) > 0 AND allowed_scopes <@ ARRAY['NETWORK'::text, 'PSP'::text, 'ORG'::text, 'CATEGORY'::text, 'COUNTRY'::text])`
- `config_param_definition_check` : `CHECK (fail_mode <> 'FALSE'::text OR type = 'BOOL'::text)`
- `config_param_definition_check1` : `CHECK (fail_mode <> 'ZERO'::text OR (type = ANY (ARRAY['INT'::text, 'DURATION'::text, 'MONEY'::text, 'BPS'::text])))`
- `config_param_definition_check2` : `CHECK (NOT currency_bound OR (type = ANY (ARRAY['MONEY'::text, 'JSON'::text])))`
- `config_param_definition_check3` : `CHECK ((type = 'ENUM'::text) = (allowed_values IS NOT NULL AND cardinality(allowed_values) > 0))`
- `config_param_definition_check4` : `CHECK (NOT go_live_switch OR type = 'BOOL'::text AND fail_mode = 'FALSE'::text AND allowed_scopes = ARRAY['COUNTRY'::text] AND NOT optional)`
- `config_param_definition_fail_mode_check` : `CHECK (fail_mode = ANY (ARRAY['BLOCK'::text, 'FALSE'::text, 'ZERO'::text]))`
- `config_param_definition_key_check` : `CHECK (key ~ '^[a-z][a-z0-9_]*$'::text)`
- `config_param_definition_pkey` : `PRIMARY KEY (key)`
- `config_param_definition_type_check` : `CHECK (type = ANY (ARRAY['INT'::text, 'BOOL'::text, 'DURATION'::text, 'MONEY'::text, 'BPS'::text, 'ENUM'::text, 'JSON'::text]))`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `catalog_cmd_claim_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'plate_claims_open_per_host'::text)`
- `catalog_cmd_insurer_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'insurer_contract_active'::text)`
- `catalog_cmd_publish_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'listing_manual_review_required'::text)`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['price_display_step_minor'::text, 'listing_min_photos'::text, 'price_ceiling_daily_minor'::text, 'price_ceiling_extra_km_minor'::text, 'p2p_private_hosts_enabled'::text, 'vehicle_financed_requires_lender_consent'::text, 'elig_age_years_ceiling'::text, 'elig_odometer_km_ceiling'::text, 'elig_doc_title'::text, 'elig_doc_plate_vin_photo'::text, 'elig_doc_inspection'::text, 'elig_doc_compulsory_insurance'::text, 'elig_doc_owner_authorization'::text, 'elig_doc_lender_consent'::text]))`
- `catalog_cmd_upload_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['upload_photo_max_kb'::text, 'upload_gallery_photos_max'::text, 'upload_documents_per_minute'::text]))`
- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `go_live_switch`
- `cmd_hold_deposit_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = 'funds_holding_enabled'::text)`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['p2p_private_hosts_enabled'::text, 'insurer_contract_active'::text]))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `go_live_switch`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `kyc_cmd_host_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(key = ANY (ARRAY['p2p_private_hosts_enabled'::text, 'insurer_contract_active'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_param_definition_guard` : `CREATE TRIGGER config_param_definition_guard BEFORE DELETE OR UPDATE ON core.config_param_definition FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_param_definition_no_truncate` : `CREATE TRIGGER config_param_definition_no_truncate BEFORE TRUNCATE ON core.config_param_definition FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_param_value`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `key` | `text` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `scope_type` | `text` | oui | — |
| `scope_id` | `text` | non | — |
| `network` | `text` | non | — |
| `currency` | `character(3)` | non | — |
| `value` | `jsonb` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `valid_to` | `timestamp with time zone` | non | — |
| `approved_by` | `uuid` | non | — |
| `decision_ref` | `text` | non | — |
| `change_reason` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `name` | oui | `CURRENT_USER` |
| `go_live_request_id` | `uuid` | non | — |

Contraintes :

- `config_param_value_change_reason_check` : `CHECK (change_reason <> ''::text)`
- `config_param_value_check` : `CHECK (valid_to IS NULL OR valid_to > valid_from)`
- `config_param_value_check1` : `CHECK ((scope_type = ANY (ARRAY['COUNTRY'::text, 'NETWORK'::text])) = (scope_id IS NULL))`
- `config_param_value_check2` : `CHECK ((scope_type = 'NETWORK'::text) = (network IS NOT NULL))`
- `config_param_value_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_param_value_currency_fkey` : `FOREIGN KEY (currency) REFERENCES core.config_currency(code)`
- `config_param_value_go_live_request_id_fkey` : `FOREIGN KEY (go_live_request_id) REFERENCES core.config_go_live_switch_request(id)`
- `config_param_value_key_country_code_scope_type_scope_id_net_key` : `UNIQUE NULLS NOT DISTINCT (key, country_code, scope_type, scope_id, network, valid_from)`
- `config_param_value_key_fkey` : `FOREIGN KEY (key) REFERENCES core.config_param_definition(key)`
- `config_param_value_pkey` : `PRIMARY KEY (id)`
- `config_param_value_scope_type_check` : `CHECK (scope_type = ANY (ARRAY['NETWORK'::text, 'PSP'::text, 'ORG'::text, 'CATEGORY'::text, 'COUNTRY'::text]))`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `catalog_cmd_claim_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'plate_claims_open_per_host'::text)`
- `catalog_cmd_insurer_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'insurer_contract_active'::text)`
- `catalog_cmd_meeting_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'review_window_days'::text)`
- `catalog_cmd_plan_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['host_share_pct'::text, 'host_default_plan'::text]))`
- `catalog_cmd_publish_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'listing_manual_review_required'::text)`
- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['price_display_step_minor'::text, 'listing_min_photos'::text, 'price_ceiling_daily_minor'::text, 'price_ceiling_extra_km_minor'::text, 'p2p_private_hosts_enabled'::text, 'advance_notice_minutes'::text, 'vehicle_financed_requires_lender_consent'::text, 'elig_age_years_ceiling'::text, 'elig_odometer_km_ceiling'::text, 'elig_doc_title'::text, 'elig_doc_plate_vin_photo'::text, 'elig_doc_inspection'::text, 'elig_doc_compulsory_insurance'::text, 'elig_doc_owner_authorization'::text, 'elig_doc_lender_consent'::text]))`
- `catalog_cmd_request_mode_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['booking_request_mode_enabled'::text, 'booking_request_expiry_hours'::text]))`
- `catalog_cmd_search_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['max_trip_days'::text, 'buffer_minutes'::text]))`
- `catalog_cmd_terms_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['free_cancel_lead'::text, 'last_minute_threshold'::text, 'insurer_rc_minimum'::text, 'last_minute_free_window_minutes'::text]))`
- `catalog_cmd_upload_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = ANY (ARRAY['upload_photo_max_kb'::text, 'upload_gallery_photos_max'::text, 'upload_documents_per_minute'::text]))`
- `catalog_cmd_value_class_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(key = 'vehicle_default_value_class'::text)`
- `cmd_golive_ins` (INSERT, PERMISSIVE, cmd_golive_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (go_live_request_id IS NOT NULL) AND (approved_by IS NOT NULL) AND (scope_type = 'COUNTRY'::text))`
- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `((go_live_request_id IS NOT NULL) OR (key IN ( SELECT d.key FROM core.config_param_definition d WHERE d.go_live_switch)))`
- `cmd_hold_cancel_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['free_cancel_lead'::text, 'last_minute_threshold'::text, 'host_penalty'::text, 'platform_funded_host_compensation'::text, 'no_show_report_review_alert_minutes'::text]))`
- `cmd_hold_claim_param_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = 'claim_declaration_window_h'::text)`
- `cmd_hold_contract_param_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = 'grace_minutes'::text)`
- `cmd_hold_deposit_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['deposit_always_required'::text, 'deposit_trigger_classes'::text, 'deposit_amount'::text, 'funds_holding_enabled'::text, 'auth_lead_h'::text, 'release_delay_h'::text, 'deposit_safety_h'::text, 'deposit_reauth_lead_h'::text, 'marge_h'::text]))`
- `cmd_hold_inspection_param_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['photo_max_kb'::text, 'photo_max_px'::text, 'clock_skew_flag_h'::text, 'p2p_contactless_handover_enabled'::text]))`
- `cmd_hold_meeting_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = 'review_window_days'::text)`
- `cmd_hold_overdue_param_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['overdue_detection_minutes'::text, 'overdue_occupancy_step_minutes'::text, 'overdue_escalation_hours'::text]))`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['buffer_minutes'::text, 'hold_ttl_minutes'::text, 'hold_max_total_minutes'::text, 'max_active_holds_per_guest'::text, 'hold_creations_per_guest_vehicle_hour'::text, 'sweep_grace_s'::text, 'flagged_booking_payment_order'::text, 'review_hold_minutes'::text, 'payment_in_flight_margin_s'::text, 'psp_call_timeout_s'::text, 'conversion_start_tolerance_minutes'::text, 'payment_attempts_per_hold'::text, 'max_trip_days'::text, 'advance_notice_minutes'::text, 'no_show_grace_minutes'::text, 'overdue_detection_minutes'::text, 'p2p_private_hosts_enabled'::text, 'insurer_contract_active'::text]))`
- `cmd_hold_request_param_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['booking_request_mode_enabled'::text, 'booking_request_expiry_hours'::text]))`
- `cmd_hold_risk_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['min_driver_age'::text, 'foreign_license_review_enabled'::text]))`
- `cmd_money_advance_cap_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `(key = 'host_advance_cap_minor'::text)`
- `cmd_money_incidental_param_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `(key = ANY (ARRAY['incidental_host_window_h'::text, 'invoice_guest_response_h'::text, 'incidental_cleaning_max_minor'::text, 'fuel_refill_max'::text, 'incidental_evidence_trip_photos_only'::text, 'incidental_fuel_extras_block'::text, 'incidental_fuel_early_end_block'::text]))`
- `cmd_money_quote_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `(key = ANY (ARRAY['grace_minutes'::text, 'max_trip_days'::text, 'host_default_plan'::text, 'host_share_pct'::text, 'delivery_share_pct'::text, 'extras_share_pct'::text, 'trip_fee_schedule'::text, 'quote_validity_minutes'::text, 'quote_freezes_per_guest_hour'::text, 'protection_grid'::text, 'guest_protection_min_level'::text, 'insurer_premium_share'::text]))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `(key = ANY (ARRAY['payouts_enabled'::text, 'insurer_contract_active'::text, 'funds_holding_enabled'::text, 'payout_account_rails'::text, 'payout_account_change_hold_h'::text, 'payout_business_day_offset'::text, 'first_payout_business_day'::text, 'payout_batch_local_time'::text, 'mit_consent_checkbox_required'::text]))`
- `cmd_param_ins` (INSERT, PERMISSIVE, cmd_param_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (scope_type = 'COUNTRY'::text) AND (approved_by IS NOT NULL) AND (decision_ref IS NOT NULL) AND (EXISTS ( SELECT 1 FROM core.config_param_change_request r WHERE ((r.status = 'APPLIED'::text) AND (r.key = config_param_value.key) AND (r.country_code = config_param_value.country_code) AND (r.value = config_param_value.value) AND (NOT (r.currency IS DISTINCT FROM config_param_value.currency)) AND (r.valid_from = config_param_value.valid_from) AND (r.approved_by = config_param_value.approved_by) AND (r.decision_ref = config_param_value.decision_ref)))))`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `((scope_type = 'COUNTRY'::text) AND (NOT (key IN ( SELECT d.key FROM core.config_param_definition d WHERE d.go_live_switch))))`
- `cmd_param_upd` (UPDATE, PERMISSIVE, cmd_param_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (scope_type = 'COUNTRY'::text) AND (valid_to IS NULL) AND (NOT (key IN ( SELECT d.key FROM core.config_param_definition d WHERE d.go_live_switch))))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (valid_to IS NOT NULL) AND (EXISTS ( SELECT 1 FROM core.config_param_change_request r WHERE ((r.status = 'APPLIED'::text) AND (r.key = config_param_value.key) AND (r.country_code = config_param_value.country_code) AND (r.valid_from = config_param_value.valid_to)))))`
- `iam_auth_host_read` (SELECT, PERMISSIVE, iam_auth_owner) USING `(key = 'host_min_age_years'::text)`
- `iam_auth_otp_read` (SELECT, PERMISSIVE, iam_auth_owner) USING `(key = ANY (ARRAY['otp_ttl_min'::text, 'otp_max_attempts'::text, 'otp_lock_min'::text, 'otp_sms_fallback_s'::text]))`
- `iam_staff_incident_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `(key = ANY (ARRAY['security_incident_authority_notice_hours'::text, 'security_incident_subjects_notice_hours'::text]))`
- `iam_staff_recon_threshold_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `(key = 'reconciliation_delta_threshold_bps'::text)`
- `iam_staff_sla_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `(key = ANY (ARRAY['kyc_review_sla_business_h'::text, 'listing_review_sla_h'::text, 'catalog_addition_sla_business_h'::text, 'review_hold_minutes'::text]))`
- `kyc_cmd_host_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(key = ANY (ARRAY['host_min_age_years'::text, 'p2p_host_requires_tax_id'::text, 'p2p_private_hosts_enabled'::text, 'insurer_contract_active'::text, 'host_tax_id_required_for_activation'::text]))`
- `kyc_cmd_host_review_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(key = ANY (ARRAY['host_review_manual_required'::text, 'host_review_auto_delay_minutes'::text]))`
- `kyc_cmd_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(key = 'biometric_appeal_retention_days'::text)`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `(key = 'review_window_days'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `(key = ANY (ARRAY['privacy_register_validated'::text, 'privacy_dsr_response_days'::text, 'evidence_retention_months'::text]))`
- `review_cmd_read` (SELECT, PERMISSIVE, review_cmd_owner) USING `(key = 'review_window_days'::text)`

Déclencheurs :

- `config_param_value_guard` : `CREATE TRIGGER config_param_value_guard BEFORE INSERT OR DELETE OR UPDATE ON core.config_param_value FOR EACH ROW EXECUTE FUNCTION core.config_param_value_guard()`
- `config_param_value_no_truncate` : `CREATE TRIGGER config_param_value_no_truncate BEFORE TRUNCATE ON core.config_param_value FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`
- `param_value_go_live_guard` : `CREATE TRIGGER param_value_go_live_guard BEFORE INSERT OR DELETE OR UPDATE ON core.config_param_value FOR EACH ROW EXECUTE FUNCTION core.config_param_value_go_live_guard()`

### `core.contract_consent`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; kyc_cmd_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `seq` | `bigint` | oui | — |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `user_id` | `uuid` | oui | — |
| `template_id` | `uuid` | oui | — |
| `doc_kind` | `text` | oui | — |
| `doc_version` | `integer` | oui | — |
| `locale` | `text` | oui | — |
| `accepted` | `boolean` | oui | — |
| `accepted_at` | `timestamp with time zone` | oui | `platform.now()` |
| `context` | `text` | oui | — |
| `country_code` | `character(2)` | non | — |
| `ip_enc` | `bytea` | non | — |
| `user_agent_enc` | `bytea` | non | — |
| `key_subject_type` | `text` | non | — |
| `key_subject_id` | `uuid` | non | — |
| `c2_withheld` | `boolean` | oui | — |

Contraintes :

- `consent_c2_key_complete` : `CHECK (ip_enc IS NULL AND user_agent_enc IS NULL OR key_subject_type IS NOT NULL AND key_subject_id IS NOT NULL)`
- `consent_c2_withheld_coherent` : `CHECK (NOT c2_withheld OR ip_enc IS NULL AND user_agent_enc IS NULL)`
- `consent_context_valid` : `CHECK (context = ANY (ARRAY['SIGNUP'::text, 'REACCEPT'::text, 'SETTINGS'::text, 'CHECKOUT'::text, 'CONTRACT'::text, 'KYC'::text, 'HOST_ONBOARDING'::text]))`
- `consent_doc_kind_valid` : `CHECK (doc_kind = ANY (ARRAY['TOS_GUEST'::text, 'TOS_HOST'::text, 'PRIVACY'::text, 'MARKETING'::text, 'BIOMETRIC_CONSENT'::text, 'DAMAGE_TERMS'::text, 'CANCELLATION_POLICY'::text, 'GEO_TERMS'::text]))`
- `consent_doc_version_positive` : `CHECK (doc_version >= 1)`
- `consent_key_pair` : `CHECK ((key_subject_type IS NULL) = (key_subject_id IS NULL))`
- `consent_key_subject_type_valid` : `CHECK (key_subject_type IS NULL OR key_subject_type = 'USER'::text)`
- `consent_locale_valid` : `CHECK (locale = ANY (ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `consent_required_not_withdrawn` : `CHECK (accepted OR (doc_kind <> ALL (ARRAY['TOS_GUEST'::text, 'PRIVACY'::text])))`
- `contract_consent_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `contract_consent_id_unique` : `UNIQUE (id)`
- `contract_consent_pkey` : `PRIMARY KEY (seq)`
- `contract_consent_template_id_fkey` : `FOREIGN KEY (template_id) REFERENCES core.contract_document_template(id)`
- `contract_consent_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `consent_user_kind_idx` : `CREATE INDEX consent_user_kind_idx ON core.contract_consent USING btree (user_id, doc_kind, seq DESC)`

Politiques RLS :

- `cmd_hold_evidence_consent_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `true`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((doc_kind = 'BIOMETRIC_CONSENT'::text) AND (context = 'KYC'::text) AND c2_withheld AND (ip_enc IS NULL) AND (user_agent_enc IS NULL))`
- `kyc_cmd_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(doc_kind = 'BIOMETRIC_CONSENT'::text)`
- `kyc_cmd_read_tos` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(doc_kind = 'TOS_GUEST'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `consent_guard` : `CREATE TRIGGER consent_guard BEFORE INSERT OR DELETE OR UPDATE ON core.contract_consent FOR EACH ROW EXECUTE FUNCTION core.ctr_consent_guard()`
- `consent_no_truncate` : `CREATE TRIGGER consent_no_truncate BEFORE TRUNCATE ON core.contract_consent FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate('consent_append_only')`

### `core.contract_document_party`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `document_id` | `uuid` | oui | — |
| `identity` | `jsonb` | oui | — |
| `body` | `jsonb` | oui | — |
| `pseudonymized_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `contract_document_party_document_id_fkey` : `FOREIGN KEY (document_id) REFERENCES core.contract_generated_document(id)`
- `contract_document_party_pkey` : `PRIMARY KEY (document_id)`
- `document_party_body_array` : `CHECK (jsonb_typeof(body) = 'array'::text)`
- `document_party_identity_object` : `CHECK (jsonb_typeof(identity) = 'object'::text)`

Politiques RLS :

- `cmd_hold_contract_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'booking_contract'::text))`
- `cmd_hold_contract_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `contract_record_no_delete` : `CREATE TRIGGER contract_record_no_delete BEFORE DELETE ON core.contract_document_party FOR EACH ROW EXECUTE FUNCTION core.contract_document_immutable()`
- `ctr_no_truncate` : `CREATE TRIGGER ctr_no_truncate BEFORE TRUNCATE ON core.contract_document_party FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate()`

### `core.contract_document_template`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; iam_staff_owner: SELECT ; kyc_cmd_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `kind` | `text` | oui | — |
| `country_code` | `character(2)` | non | — |
| `locale` | `text` | oui | — |
| `version` | `integer` | oui | — |
| `is_major` | `boolean` | oui | — |
| `title` | `text` | oui | — |
| `body_md` | `text` | oui | — |
| `content_hash` | `bytea` | oui | — |
| `legal_review_ref` | `text` | non | — |
| `is_authoritative` | `boolean` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `published_by` | `uuid` | non | — |
| `request_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `contract_document_template_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `contract_document_template_pkey` : `PRIMARY KEY (id)`
- `contract_document_template_published_by_fkey` : `FOREIGN KEY (published_by) REFERENCES core.iam_user_account(id)`
- `document_template_authoritative_es` : `CHECK (is_authoritative = (locale = 'es'::text))`
- `document_template_body_length` : `CHECK (length(body_md) >= 1 AND length(body_md) <= 200000)`
- `document_template_hash_sha256` : `CHECK (octet_length(content_hash) = 32)`
- `document_template_kind_valid` : `CHECK (kind = ANY (ARRAY['TOS_GUEST'::text, 'TOS_HOST'::text, 'PRIVACY'::text, 'MARKETING'::text, 'BIOMETRIC_CONSENT'::text, 'RENTAL_CONTRACT'::text, 'CONSTANCIA'::text, 'DAMAGE_TERMS'::text, 'CANCELLATION_POLICY'::text, 'GEO_TERMS'::text]))`
- `document_template_locale_valid` : `CHECK (locale = ANY (ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `document_template_request_unique` : `UNIQUE (request_id, locale)`
- `document_template_review_ref_length` : `CHECK (legal_review_ref IS NULL OR length(legal_review_ref) >= 1 AND length(legal_review_ref) <= 200)`
- `document_template_title_length` : `CHECK (length(title) >= 1 AND length(title) <= 200)`
- `document_template_version_positive` : `CHECK (version >= 1)`
- `document_template_version_unique` : `UNIQUE NULLS NOT DISTINCT (kind, country_code, locale, version)`

Index :

- `document_template_current_idx` : `CREATE INDEX document_template_current_idx ON core.contract_document_template USING btree (kind, country_code, version DESC)`

Politiques RLS :

- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(kind = 'BIOMETRIC_CONSENT'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `document_template_guard` : `CREATE TRIGGER document_template_guard BEFORE INSERT OR DELETE OR UPDATE ON core.contract_document_template FOR EACH ROW EXECUTE FUNCTION core.ctr_template_guard()`
- `document_template_no_truncate` : `CREATE TRIGGER document_template_no_truncate BEFORE TRUNCATE ON core.contract_document_template FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate('document_template_immutable')`

### `core.contract_generated_document`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `kind` | `text` | oui | — |
| `template_id` | `uuid` | oui | — |
| `courtesy_template_id` | `uuid` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `locale` | `text` | oui | — |
| `version` | `integer` | oui | — |
| `supersedes_id` | `uuid` | non | — |
| `trigger_key` | `text` | oui | — |
| `terms` | `jsonb` | oui | — |
| `derived` | `jsonb` | oui | — |
| `renderer_version` | `text` | oui | — |
| `sha256` | `bytea` | oui | — |
| `generated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `contract_generated_document_courtesy_template_id_fkey` : `FOREIGN KEY (courtesy_template_id) REFERENCES core.contract_document_template(id)`
- `contract_generated_document_pkey` : `PRIMARY KEY (id)`
- `contract_generated_document_subject_id_fkey` : `FOREIGN KEY (subject_id) REFERENCES core.booking_trip_segment(id)`
- `contract_generated_document_supersedes_id_fkey` : `FOREIGN KEY (supersedes_id) REFERENCES core.contract_generated_document(id)`
- `contract_generated_document_template_id_fkey` : `FOREIGN KEY (template_id) REFERENCES core.contract_document_template(id)`
- `contract_generated_document_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `generated_document_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `generated_document_derived_object` : `CHECK (jsonb_typeof(derived) = 'object'::text)`
- `generated_document_first_version` : `CHECK ((version = 1) = (supersedes_id IS NULL))`
- `generated_document_kind_valid` : `CHECK (kind = 'RENTAL_CONTRACT'::text)`
- `generated_document_locale_valid` : `CHECK (locale = ANY (ARRAY['en'::text, 'fr'::text, 'pt'::text]))`
- `generated_document_renderer_format` : `CHECK (renderer_version ~ '^ctr\.pdf/[0-9]{1,3}$'::text)`
- `generated_document_sha256_length` : `CHECK (octet_length(sha256) = 32)`
- `generated_document_subject_valid` : `CHECK (subject_type = 'TRIP_SEGMENT'::text)`
- `generated_document_supersedes_unique` : `UNIQUE (supersedes_id)`
- `generated_document_terms_object` : `CHECK (jsonb_typeof(terms) = 'object'::text)`
- `generated_document_trigger_format` : `CHECK (trigger_key ~ '^[A-Za-z0-9:._-]{1,100}$'::text)`
- `generated_document_trigger_unique` : `UNIQUE (trip_id, trigger_key)`
- `generated_document_version_positive` : `CHECK (version >= 1)`
- `generated_document_version_unique` : `UNIQUE (subject_id, version)`

Index :

- `generated_document_trip_idx` : `CREATE INDEX generated_document_trip_idx ON core.contract_generated_document USING btree (trip_id, version)`

Politiques RLS :

- `cmd_hold_contract_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'booking_contract'::text))`
- `cmd_hold_contract_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `contract_record_immutable` : `CREATE TRIGGER contract_record_immutable BEFORE DELETE OR UPDATE ON core.contract_generated_document FOR EACH ROW EXECUTE FUNCTION core.contract_document_immutable()`
- `ctr_no_truncate` : `CREATE TRIGGER ctr_no_truncate BEFORE TRUNCATE ON core.contract_generated_document FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate()`

### `core.contract_signature`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `document_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `signer_user_id` | `uuid` | oui | — |
| `signer_role` | `text` | oui | — |
| `method` | `text` | oui | — |
| `otp_challenge_id` | `uuid` | non | — |
| `signed_at` | `timestamp with time zone` | oui | `platform.now()` |
| `document_sha256` | `bytea` | oui | — |
| `seal_sha256` | `bytea` | oui | — |
| `ip_enc` | `bytea` | non | — |
| `user_agent_enc` | `bytea` | non | — |
| `key_subject_type` | `text` | non | — |
| `key_subject_id` | `uuid` | non | — |
| `c2_withheld` | `boolean` | oui | — |

Contraintes :

- `contract_signature_document_id_fkey` : `FOREIGN KEY (document_id) REFERENCES core.contract_generated_document(id)`
- `contract_signature_otp_challenge_id_fkey` : `FOREIGN KEY (otp_challenge_id) REFERENCES core.iam_otp_challenge(id)`
- `contract_signature_pkey` : `PRIMARY KEY (id)`
- `contract_signature_signer_user_id_fkey` : `FOREIGN KEY (signer_user_id) REFERENCES core.iam_user_account(id)`
- `contract_signature_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `signature_c2_withheld_coherent` : `CHECK (NOT c2_withheld OR ip_enc IS NULL AND user_agent_enc IS NULL)`
- `signature_document_sha256_length` : `CHECK (octet_length(document_sha256) = 32)`
- `signature_key_coherent` : `CHECK (ip_enc IS NULL AND user_agent_enc IS NULL OR key_subject_id IS NOT NULL)`
- `signature_key_subject_type_valid` : `CHECK (key_subject_type IS NULL OR key_subject_type = 'USER'::text)`
- `signature_method_valid` : `CHECK (method = ANY (ARRAY['CLICKWRAP'::text, 'CLICKWRAP_OTP'::text]))`
- `signature_one_per_signer` : `UNIQUE (document_id, signer_user_id)`
- `signature_otp_method` : `CHECK ((method = 'CLICKWRAP_OTP'::text) = (otp_challenge_id IS NOT NULL))`
- `signature_role_valid` : `CHECK (signer_role = 'GUEST'::text)`
- `signature_seal_sha256_length` : `CHECK (octet_length(seal_sha256) = 32)`

Index :

- `contract_signature_trip_idx` : `CREATE INDEX contract_signature_trip_idx ON core.contract_signature USING btree (trip_id)`

Politiques RLS :

- `cmd_hold_contract_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((signer_role = 'GUEST'::text) AND c2_withheld)`
- `cmd_hold_contract_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `contract_record_immutable` : `CREATE TRIGGER contract_record_immutable BEFORE DELETE OR UPDATE ON core.contract_signature FOR EACH ROW EXECUTE FUNCTION core.contract_document_immutable()`
- `ctr_no_truncate` : `CREATE TRIGGER ctr_no_truncate BEFORE TRUNCATE ON core.contract_signature FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate()`

### `core.finance_legal_entity`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `country_code` | `character(2)` | oui | — |
| `name` | `text` | oui | — |
| `country_of_incorporation` | `character(2)` | oui | — |
| `tax_id` | `text` | oui | — |
| `invoicing_regime` | `text` | oui | — |

Contraintes :

- `finance_legal_entity_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `finance_legal_entity_country_code_key` : `UNIQUE (country_code)`
- `finance_legal_entity_country_of_incorporation_check` : `CHECK (country_of_incorporation ~ '^[A-Z]{2}$'::text)`
- `finance_legal_entity_invoicing_regime_check` : `CHECK (invoicing_regime ~ '^[A-Z][A-Z0-9_]*$'::text)`
- `finance_legal_entity_name_check` : `CHECK (name <> ''::text)`
- `finance_legal_entity_pkey` : `PRIMARY KEY (id)`
- `finance_legal_entity_tax_id_check` : `CHECK (tax_id <> ''::text)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `finance_legal_entity_guard` : `CREATE TRIGGER finance_legal_entity_guard BEFORE DELETE OR UPDATE ON core.finance_legal_entity FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `finance_legal_entity_no_truncate` : `CREATE TRIGGER finance_legal_entity_no_truncate BEFORE TRUNCATE ON core.finance_legal_entity FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.finance_reconciliation_item`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `run_id` | `uuid` | oui | — |
| `side` | `text` | oui | — |
| `ref` | `text` | oui | — |
| `leg` | `text` | non | — |
| `component` | `text` | non | — |
| `expected_minor` | `bigint` | non | — |
| `observed_minor` | `bigint` | non | — |
| `delta_minor` | `bigint` | oui | — |
| `status` | `text` | oui | — |
| `finding` | `text` | non | — |
| `resolution` | `text` | non | — |
| `resolution_note` | `text` | non | — |
| `resolved_by` | `uuid` | non | — |
| `resolved_at` | `timestamp with time zone` | non | — |

Contraintes :

- `finance_recon_item_component_valid` : `CHECK (component = ANY (ARRAY['AMOUNT'::text, 'CAPTURED'::text, 'REFUNDED'::text, 'REALLOCATED_IN'::text, 'REALLOCATED_OUT'::text, 'RELEASED'::text]))`
- `finance_recon_item_delta_nonneg` : `CHECK (delta_minor >= 0)`
- `finance_recon_item_finding_valid` : `CHECK (finding = ANY (ARRAY['OPERATION_WITHOUT_TRIP'::text, 'OPERATION_NOT_IN_PSP'::text, 'LEG_WITHOUT_TRIP'::text, 'LEG_NOT_IN_PSP'::text, 'AMOUNT'::text]))`
- `finance_recon_item_leg_valid` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `finance_recon_item_matched_shape` : `CHECK ((status = 'MATCHED'::text) = (finding IS NULL) AND (status = 'MATCHED'::text) = (delta_minor = 0))`
- `finance_recon_item_note_length` : `CHECK (char_length(resolution_note) >= 10 AND char_length(resolution_note) <= 500)`
- `finance_recon_item_ref_format` : `CHECK (ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `finance_recon_item_resolution_shape` : `CHECK ((resolution IS NULL) = (resolved_at IS NULL) AND (resolution IS NULL) = (resolved_by IS NULL) AND (resolution IS NULL) = (resolution_note IS NULL) AND (resolution IS NULL OR status <> 'MATCHED'::text))`
- `finance_recon_item_resolution_valid` : `CHECK (resolution = ANY (ARRAY['TIMING'::text, 'PSP_FEE'::text, 'PSP_ERROR'::text, 'PLATFORM_ERROR'::text, 'DUPLICATE'::text, 'OTHER'::text]))`
- `finance_recon_item_run_fk` : `FOREIGN KEY (run_id) REFERENCES core.finance_reconciliation_run(id)`
- `finance_recon_item_side_valid` : `CHECK (side = ANY (ARRAY['PSP'::text, 'PLATFORM'::text]))`
- `finance_recon_item_status_valid` : `CHECK (status = ANY (ARRAY['MATCHED'::text, 'MISSING_PLATFORM'::text, 'MISSING_PSP'::text, 'AMOUNT_MISMATCH'::text]))`
- `finance_reconciliation_item_pkey` : `PRIMARY KEY (id)`
- `finance_reconciliation_item_resolved_by_fkey` : `FOREIGN KEY (resolved_by) REFERENCES core.iam_user_account(id)`

Index :

- `finance_reconciliation_item_run_idx` : `CREATE INDEX finance_reconciliation_item_run_idx ON core.finance_reconciliation_item USING btree (run_id)`

Politiques RLS :

- `iam_staff_recon_ins` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(resolution IS NULL)`
- `iam_staff_recon_resolve` (UPDATE, PERMISSIVE, iam_staff_owner) USING `((resolution IS NULL) AND (status <> 'MATCHED'::text))` WITH CHECK `(resolution IS NOT NULL)`
- `iam_staff_recon_sel` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `finance_reconciliation_guard` : `CREATE TRIGGER finance_reconciliation_guard BEFORE DELETE OR UPDATE ON core.finance_reconciliation_item FOR EACH ROW EXECUTE FUNCTION core.finance_reconciliation_guard()`
- `finance_reconciliation_no_truncate` : `CREATE TRIGGER finance_reconciliation_no_truncate BEFORE TRUNCATE ON core.finance_reconciliation_item FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('finance_reconciliation_guard')`

### `core.finance_reconciliation_run`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `scope` | `text` | oui | `'PSP_MONTHLY_MANUAL'::text` |
| `source` | `text` | oui | `'CSV_IMPORT'::text` |
| `period_month` | `date` | oui | — |
| `psp_lines` | `integer` | oui | — |
| `matched` | `integer` | oui | — |
| `unmatched_platform` | `integer` | oui | — |
| `unmatched_psp` | `integer` | oui | — |
| `amount_mismatches` | `integer` | oui | — |
| `platform_total_minor` | `bigint` | oui | — |
| `delta_minor` | `bigint` | oui | — |
| `delta_pct_bps` | `integer` | oui | — |
| `threshold_bps` | `integer` | oui | — |
| `threshold_source` | `text` | oui | — |
| `exceeds_threshold` | `boolean` | oui | — |
| `treat_by` | `date` | non | — |
| `status` | `text` | oui | — |
| `created_by` | `uuid` | oui | — |
| `created_role` | `text` | oui | — |
| `request_id` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `closed_by` | `uuid` | non | — |
| `closed_role` | `text` | non | — |
| `closed_at` | `timestamp with time zone` | non | — |
| `checklist` | `jsonb` | non | — |
| `unexplained_at_close` | `integer` | non | — |

Contraintes :

- `finance_recon_run_bps_nonneg` : `CHECK (delta_pct_bps >= 0)`
- `finance_recon_run_closed_role_valid` : `CHECK (closed_role = ANY (ARRAY['FINANCE'::text, 'ADMIN'::text]))`
- `finance_recon_run_closed_shape` : `CHECK ((status = 'CLOSED'::text) = (closed_at IS NOT NULL) AND (closed_at IS NULL) = (closed_by IS NULL) AND (closed_at IS NULL) = (closed_role IS NULL) AND (closed_at IS NULL) = (checklist IS NULL) AND (closed_at IS NULL) = (unexplained_at_close IS NULL))`
- `finance_recon_run_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `finance_recon_run_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `finance_recon_run_delta_nonneg` : `CHECK (delta_minor >= 0)`
- `finance_recon_run_kind_valid` : `CHECK (kind = ANY (ARRAY['OPERATIONS'::text, 'LEGS'::text]))`
- `finance_recon_run_lines_nonneg` : `CHECK (psp_lines >= 0)`
- `finance_recon_run_matched_nonneg` : `CHECK (matched >= 0)`
- `finance_recon_run_mm_nonneg` : `CHECK (amount_mismatches >= 0)`
- `finance_recon_run_month_first` : `CHECK (period_month = date_trunc('month'::text, period_month::timestamp with time zone)::date)`
- `finance_recon_run_request_unique` : `UNIQUE (request_id)`
- `finance_recon_run_role_valid` : `CHECK (created_role = ANY (ARRAY['FINANCE'::text, 'ADMIN'::text]))`
- `finance_recon_run_scope_valid` : `CHECK (scope = 'PSP_MONTHLY_MANUAL'::text)`
- `finance_recon_run_source_valid` : `CHECK (source = 'CSV_IMPORT'::text)`
- `finance_recon_run_status_valid` : `CHECK (status = ANY (ARRAY['MATCHED'::text, 'DISCREPANCIES'::text, 'CLOSED'::text]))`
- `finance_recon_run_threshold_nonneg` : `CHECK (threshold_bps >= 0)`
- `finance_recon_run_threshold_source` : `CHECK (threshold_source = ANY (ARRAY['PARAM'::text, 'ABSENT_ZERO'::text]))`
- `finance_recon_run_total_nonneg` : `CHECK (platform_total_minor >= 0)`
- `finance_recon_run_treat_shape` : `CHECK (exceeds_threshold OR treat_by IS NULL)`
- `finance_recon_run_unexplained_nonneg` : `CHECK (unexplained_at_close >= 0)`
- `finance_recon_run_up_nonneg` : `CHECK (unmatched_platform >= 0)`
- `finance_recon_run_upsp_nonneg` : `CHECK (unmatched_psp >= 0)`
- `finance_reconciliation_run_closed_by_fkey` : `FOREIGN KEY (closed_by) REFERENCES core.iam_user_account(id)`
- `finance_reconciliation_run_created_by_fkey` : `FOREIGN KEY (created_by) REFERENCES core.iam_user_account(id)`
- `finance_reconciliation_run_pkey` : `PRIMARY KEY (id)`

Index :

- `finance_reconciliation_run_month_idx` : `CREATE INDEX finance_reconciliation_run_month_idx ON core.finance_reconciliation_run USING btree (country_code, period_month, kind)`

Politiques RLS :

- `iam_staff_recon_close` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['MATCHED'::text, 'DISCREPANCIES'::text]))` WITH CHECK `(status = 'CLOSED'::text)`
- `iam_staff_recon_ins` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(status = ANY (ARRAY['MATCHED'::text, 'DISCREPANCIES'::text]))`
- `iam_staff_recon_sel` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `finance_reconciliation_guard` : `CREATE TRIGGER finance_reconciliation_guard BEFORE DELETE OR UPDATE ON core.finance_reconciliation_run FOR EACH ROW EXECUTE FUNCTION core.finance_reconciliation_guard()`
- `finance_reconciliation_no_truncate` : `CREATE TRIGGER finance_reconciliation_no_truncate BEFORE TRUNCATE ON core.finance_reconciliation_run FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('finance_reconciliation_guard')`

### `core.iam_auth_factor`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `secret_ref` | `text` | oui | — |
| `enabled_at` | `timestamp with time zone` | non | — |
| `disabled_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `last_used_step` | `bigint` | non | — |
| `failed_attempts` | `integer` | oui | `0` |
| `locked_until` | `timestamp with time zone` | non | — |
| `enrollment_code_hash` | `bytea` | non | — |
| `enrollment_expires_at` | `timestamp with time zone` | non | — |

Contraintes :

- `auth_factor_enrollment_complete` : `CHECK ((enrollment_code_hash IS NULL) = (enrollment_expires_at IS NULL))`
- `auth_factor_enrollment_sha256` : `CHECK (enrollment_code_hash IS NULL OR octet_length(enrollment_code_hash) = 32)`
- `auth_factor_failed_nonneg` : `CHECK (failed_attempts >= 0)`
- `auth_factor_kind_valid` : `CHECK (kind = ANY (ARRAY['TOTP'::text, 'PHONE_OTP'::text]))`
- `auth_factor_secret_ref_format` : `CHECK (secret_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]+$'::text AND length(secret_ref) <= 512)`
- `auth_factor_step_nonneg` : `CHECK (last_used_step IS NULL OR last_used_step >= 0)`
- `auth_factor_totp_state` : `CHECK (kind <> 'TOTP'::text OR disabled_at IS NOT NULL OR enabled_at IS NOT NULL AND enrollment_code_hash IS NULL OR enabled_at IS NULL AND enrollment_code_hash IS NOT NULL)`
- `iam_auth_factor_pkey` : `PRIMARY KEY (id)`
- `iam_auth_factor_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `auth_factor_one_live_totp` : `CREATE UNIQUE INDEX auth_factor_one_live_totp ON core.iam_auth_factor USING btree (user_id) WHERE ((kind = 'TOTP'::text) AND (disabled_at IS NULL))`
- `auth_factor_user_idx` : `CREATE INDEX auth_factor_user_idx ON core.iam_auth_factor USING btree (user_id)`

Politiques RLS :

- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((kind = 'TOTP'::text) AND (enabled_at IS NULL) AND (disabled_at IS NULL) AND (enrollment_code_hash IS NOT NULL))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `((kind = 'TOTP'::text) AND (disabled_at IS NULL))` WITH CHECK `(kind = 'TOTP'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_auth_factor FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_email_verification`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `email` | `text` | oui | — |
| `token_hash` | `bytea` | oui | — |
| `sent_at` | `timestamp with time zone` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `consumed_at` | `timestamp with time zone` | non | — |
| `ip` | `inet` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `email_verification_token_sha256` : `CHECK (octet_length(token_hash) = 32)`
- `email_verification_token_unique` : `UNIQUE (token_hash)`
- `email_verification_window` : `CHECK (expires_at > sent_at)`
- `iam_email_verification_pkey` : `PRIMARY KEY (id)`
- `iam_email_verification_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `email_verification_user_idx` : `CREATE INDEX email_verification_user_idx ON core.iam_email_verification USING btree (user_id)`

Politiques RLS :

- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `(consumed_at IS NULL)`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(consumed_at IS NULL)` WITH CHECK `(consumed_at IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_email_verification FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_membership`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `role` | `text` | oui | — |
| `vehicle_scope` | `uuid[]` | oui | `'{}'::uuid[]` |
| `permission_overrides` | `text[]` | oui | `'{}'::text[]` |
| `status` | `text` | oui | `'INVITED'::text` |
| `invite_expires_at` | `timestamp with time zone` | non | — |
| `holder_ref` | `uuid` | non | `CASE WHEN (role = 'P2P_HOST'::text) THEN user_id ELSE NULL::uuid END` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_membership_org_id_fkey` : `FOREIGN KEY (org_id) REFERENCES core.iam_organization(id)`
- `iam_membership_pkey` : `PRIMARY KEY (id)`
- `iam_membership_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `membership_holder_matches_org` : `FOREIGN KEY (org_id, holder_ref) REFERENCES core.iam_organization(id, holder_user_id)`
- `membership_role_valid` : `CHECK (role = ANY (ARRAY['P2P_HOST'::text, 'CO_HOST'::text]))`
- `membership_scope_cohost_only` : `CHECK (role = 'CO_HOST'::text OR cardinality(vehicle_scope) = 0)`
- `membership_scope_no_null` : `CHECK (array_position(vehicle_scope, NULL::uuid) IS NULL)`
- `membership_status_valid` : `CHECK (status = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'REMOVED'::text]))`
- `membership_user_org_role_unique` : `UNIQUE (user_id, org_id, role)`

Index :

- `membership_one_active_holder` : `CREATE UNIQUE INDEX membership_one_active_holder ON core.iam_membership USING btree (org_id) WHERE ((role = 'P2P_HOST'::text) AND (status = 'ACTIVE'::text))`
- `membership_org_live_idx` : `CREATE INDEX membership_org_live_idx ON core.iam_membership USING btree (org_id, user_id) WHERE (status = ANY (ARRAY['ACTIVE'::text, 'INVITED'::text]))`
- `membership_user_idx` : `CREATE INDEX membership_user_idx ON core.iam_membership USING btree (user_id) WHERE (status = 'ACTIVE'::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((role = 'P2P_HOST'::text) AND (status = 'ACTIVE'::text) AND (cardinality(vehicle_scope) = 0) AND (cardinality(permission_overrides) = 0))`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `membership_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (app.is_org_holder() OR ((user_id = app.actor_id()) AND (status = 'ACTIVE'::text))))`
- `membership_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (EXISTS ( SELECT 1 FROM core.iam_organization o WHERE ((o.id = iam_membership.org_id) AND (o.country_code = ANY (app.country_scope())) AND app.has_staff_role('ADMIN'::text, o.country_code)))))`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_membership FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_mfa_proof_key`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `smallint` | oui | — |
| `key` | `bytea` | oui | — |
| `installed_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `mfa_proof_key_length` : `CHECK (octet_length(key) >= 32 AND octet_length(key) <= 64)`
- `mfa_proof_key_pkey` : `PRIMARY KEY (id)`
- `mfa_proof_key_slot` : `CHECK (id = ANY (ARRAY[1, 2]))`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.iam_organization`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `kind` | `text` | oui | `'P2P_HOST_INDIVIDUAL'::text` |
| `holder_user_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `display_name` | `text` | non | — |
| `tax_id` | `text` | non | — |
| `status` | `text` | oui | `'ONBOARDING'::text` |
| `plan_code` | `text` | non | — |
| `legal_entity_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_organization_holder_user_id_fkey` : `FOREIGN KEY (holder_user_id) REFERENCES core.iam_user_account(id)`
- `iam_organization_pkey` : `PRIMARY KEY (id)`
- `organization_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `organization_country_holder_unique` : `UNIQUE (country_code, holder_user_id)`
- `organization_id_country_unique` : `UNIQUE (id, country_code)`
- `organization_id_holder_unique` : `UNIQUE (id, holder_user_id)`
- `organization_kind_valid` : `CHECK (kind = 'P2P_HOST_INDIVIDUAL'::text)`
- `organization_status_valid` : `CHECK (status = ANY (ARRAY['ONBOARDING'::text, 'PENDING_ACTIVATION'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'OFFBOARDED'::text]))`

Index :

- `iam_organization_holder_idx` : `CREATE INDEX iam_organization_holder_idx ON core.iam_organization USING btree (holder_user_id)`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((kind = 'P2P_HOST_INDIVIDUAL'::text) AND (status = 'ONBOARDING'::text) AND (tax_id IS NULL) AND (plan_code IS NULL) AND (legal_entity_id IS NULL))`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_host_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `((kind = 'P2P_HOST_INDIVIDUAL'::text) AND (status = ANY (ARRAY['ONBOARDING'::text, 'PENDING_ACTIVATION'::text])))` WITH CHECK `((kind = 'P2P_HOST_INDIVIDUAL'::text) AND ((status = 'PENDING_ACTIVATION'::text) OR ((status = 'ACTIVE'::text) AND core.kyc_host_activation_allowed(id, country_code))))`
- `kyc_cmd_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `organization_holder_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (id = app.org_id()) AND app.is_org_holder())`
- `organization_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code)))`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`
- `review_cmd_read` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_organization FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_otp_challenge`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: DELETE, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | non | — |
| `phone_e164` | `text` | non | — |
| `channel` | `text` | oui | — |
| `code_hash` | `bytea` | non | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `attempts` | `integer` | oui | `0` |
| `locked_until` | `timestamp with time zone` | non | — |
| `purpose` | `text` | oui | — |
| `consumed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `country_code` | `text` | non | — |
| `issued_at` | `timestamp with time zone` | non | — |

Contraintes :

- `iam_otp_challenge_pkey` : `PRIMARY KEY (id)`
- `iam_otp_challenge_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `otp_challenge_attempts_nonneg` : `CHECK (attempts >= 0)`
- `otp_challenge_channel_valid` : `CHECK (channel = ANY (ARRAY['WHATSAPP'::text, 'SMS'::text, 'EMAIL'::text]))`
- `otp_challenge_code_hash_sha256` : `CHECK (code_hash IS NULL OR octet_length(code_hash) = 32)`
- `otp_challenge_country_format` : `CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'::text)`
- `otp_challenge_issued` : `CHECK ((code_hash IS NULL) = (issued_at IS NULL))`
- `otp_challenge_phone_e164` : `CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text)`
- `otp_challenge_purpose_valid` : `CHECK (purpose = ANY (ARRAY['PHONE_VERIFY'::text, 'SIGNATURE'::text, 'LOGIN'::text]))`
- `otp_challenge_target` : `CHECK (user_id IS NOT NULL OR phone_e164 IS NOT NULL)`

Index :

- `otp_challenge_user_latest_idx` : `CREATE INDEX otp_challenge_user_latest_idx ON core.iam_otp_challenge USING btree (user_id, purpose, created_at DESC, id DESC)`

Politiques RLS :

- `iam_auth_delete` (DELETE, PERMISSIVE, iam_auth_owner) USING `(created_at < (platform.now() - make_interval(days => 30)))`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((code_hash IS NULL) AND (issued_at IS NULL) AND (consumed_at IS NULL) AND (locked_until IS NULL) AND (purpose = 'PHONE_VERIFY'::text) AND (channel = 'SMS'::text) AND (user_id IS NOT NULL) AND (phone_e164 IS NOT NULL) AND (country_code IS NOT NULL))`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(consumed_at IS NULL)` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_otp_challenge FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_restriction`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `active` | `boolean` | oui | `true` |
| `reason` | `text` | non | — |
| `source_ref` | `text` | non | — |
| `lifted_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_restriction_pkey` : `PRIMARY KEY (id)`
- `iam_restriction_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `restriction_kind_valid` : `CHECK (kind = ANY (ARRAY['UNPAID_BALANCE'::text, 'CHARGEBACK'::text, 'PAYMENT_PLAN_ACTIVE'::text, 'TS_HOLD'::text, 'KYC_REVOKED'::text, 'POLICY_VIOLATION'::text]))`
- `restriction_lifted_consistent` : `CHECK (active = (lifted_at IS NULL))`

Index :

- `restriction_user_active_idx` : `CREATE INDEX restriction_user_active_idx ON core.iam_restriction USING btree (user_id) WHERE active`
- `restriction_user_kind_active_unique` : `CREATE UNIQUE INDEX restriction_user_kind_active_unique ON core.iam_restriction USING btree (user_id, kind) WHERE active`

Politiques RLS :

- `catalog_cmd_search_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `active`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_debt_restriction_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((kind = 'UNPAID_BALANCE'::text) AND active AND (source_ref ~~ 'debt:%'::text) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_money_debt_restriction_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `(kind = 'UNPAID_BALANCE'::text)`
- `cmd_money_debt_restriction_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((kind = 'UNPAID_BALANCE'::text) AND (source_ref ~~ 'debt:%'::text) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((kind = 'UNPAID_BALANCE'::text) AND (NOT active) AND (source_ref ~~ 'debt:%'::text) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((kind = ANY (ARRAY['TS_HOLD'::text, 'POLICY_VIOLATION'::text])) AND active)`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `((kind = ANY (ARRAY['TS_HOLD'::text, 'POLICY_VIOLATION'::text])) AND active)` WITH CHECK `((kind = ANY (ARRAY['TS_HOLD'::text, 'POLICY_VIOLATION'::text])) AND (NOT active))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_host_signal_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_restriction FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_role_permission`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `role` | `text` | oui | — |
| `permission_code` | `text` | oui | — |
| `scope_rule` | `text` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `valid_to` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `approved_by` | `uuid` | non | — |
| `change_reason` | `text` | oui | — |

Contraintes :

- `role_permission_code_format` : `CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'::text)`
- `role_permission_pkey` : `PRIMARY KEY (role, permission_code, valid_from)`
- `role_permission_role_valid` : `CHECK (role = ANY (ARRAY['GUEST'::text, 'P2P_HOST'::text, 'CO_HOST'::text, 'SUPPORT_AGENT'::text, 'OPS_AGENT'::text, 'FINANCE'::text, 'ADMIN'::text, 'SUPERADMIN'::text]))`
- `role_permission_scope_valid` : `CHECK (scope_rule = ANY (ARRAY['ORG'::text, 'VEHICLE'::text, 'SELF'::text, 'PLATFORM'::text]))`
- `role_permission_window` : `CHECK (valid_to IS NULL OR valid_to > valid_from)`

Politiques RLS :

- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `(permission_code = 'message.trip_thread'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

### `core.iam_session`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `token_hash` | `bytea` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `ip` | `inet` | non | — |
| `user_agent` | `text` | non | — |
| `revoked_at` | `timestamp with time zone` | non | — |
| `revoked_reason` | `text` | non | — |
| `mfa_level` | `text` | oui | `'NONE'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_session_pkey` : `PRIMARY KEY (id)`
- `iam_session_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `session_mfa_level_valid` : `CHECK (mfa_level = ANY (ARRAY['NONE'::text, 'OTP'::text, 'TOTP'::text]))`
- `session_revocation_complete` : `CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))`
- `session_revoked_reason_valid` : `CHECK (revoked_reason = ANY (ARRAY['LOGOUT'::text, 'LOGOUT_ALL'::text, 'ROTATED'::text, 'EMAIL_VERIFIED'::text, 'ADMIN'::text, 'PASSWORD_CHANGED'::text, 'ACCOUNT_CLOSED'::text]))`
- `session_token_sha256` : `CHECK (octet_length(token_hash) = 32)`
- `session_token_unique` : `UNIQUE (token_hash)`
- `session_user_agent_length` : `CHECK (user_agent IS NULL OR length(user_agent) <= 512)`
- `session_window` : `CHECK (expires_at > created_at)`

Index :

- `session_user_live_idx` : `CREATE INDEX session_user_live_idx ON core.iam_session USING btree (user_id) WHERE (revoked_at IS NULL)`

Politiques RLS :

- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((revoked_at IS NULL) AND (mfa_level = 'NONE'::text))`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(revoked_at IS NULL)` WITH CHECK `(revoked_at IS NOT NULL)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(revoked_at IS NULL)` WITH CHECK `(((revoked_at IS NULL) AND (mfa_level = 'TOTP'::text)) OR ((revoked_at IS NOT NULL) AND (revoked_reason = 'ADMIN'::text)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `session_guarded_columns` : `CREATE TRIGGER session_guarded_columns BEFORE UPDATE ON core.iam_session FOR EACH ROW EXECUTE FUNCTION core.iam_session_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_session FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_staff_role_assignment`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `role` | `text` | oui | — |
| `country_scope` | `text[]` | oui | — |
| `granted_by` | `uuid` | non | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_staff_role_assignment_granted_by_fkey` : `FOREIGN KEY (granted_by) REFERENCES core.iam_user_account(id)`
- `iam_staff_role_assignment_pkey` : `PRIMARY KEY (id)`
- `iam_staff_role_assignment_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `staff_country_scope_format` : `CHECK (cardinality(country_scope) >= 1 AND array_position(country_scope, NULL::text) IS NULL AND array_to_string(country_scope, ','::text) ~ '^[A-Z]{2}(,[A-Z]{2})*$'::text)`
- `staff_no_self_grant` : `CHECK (granted_by IS NULL OR granted_by <> user_id)`
- `staff_role_valid` : `CHECK (role = ANY (ARRAY['SUPPORT_AGENT'::text, 'OPS_AGENT'::text, 'FINANCE'::text, 'ADMIN'::text, 'SUPERADMIN'::text]))`

Index :

- `staff_role_user_idx` : `CREATE INDEX staff_role_user_idx ON core.iam_staff_role_assignment USING btree (user_id)`

Politiques RLS :

- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `((expires_at IS NULL) OR (expires_at > platform.now()))` WITH CHECK `((expires_at IS NOT NULL) AND (expires_at <= platform.now()))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_staff_role_assignment FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_user_account`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `email` | `text` | oui | — |
| `email_verified_at` | `timestamp with time zone` | non | — |
| `phone_e164` | `text` | non | — |
| `phone_verified_at` | `timestamp with time zone` | non | — |
| `phone_line_type` | `text` | non | — |
| `password_hash` | `text` | non | — |
| `legal_first_name` | `text` | oui | — |
| `legal_last_name` | `text` | oui | — |
| `display_name` | `text` | non | — |
| `date_of_birth` | `date` | non | — |
| `preferred_locale` | `text` | oui | — |
| `residence_country` | `text` | non | — |
| `status` | `text` | oui | `'PENDING_EMAIL'::text` |
| `pseudonymized_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `ctr_signup_consents_required` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `iam_user_account_pkey` : `PRIMARY KEY (id)`
- `user_account_email_normalized` : `CHECK (email = lower(email) AND email = btrim(email) AND length(email) >= 3 AND length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text)`
- `user_account_email_unique` : `UNIQUE (email)`
- `user_account_legal_names_present` : `CHECK (length(btrim(legal_first_name)) >= 1 AND length(btrim(legal_first_name)) <= 100 AND length(btrim(legal_last_name)) >= 1 AND length(btrim(legal_last_name)) <= 100)`
- `user_account_locale_format` : `CHECK (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)`
- `user_account_password_hash_argon2id` : `CHECK (password_hash IS NULL OR password_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'::text)`
- `user_account_phone_e164` : `CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text)`
- `user_account_residence_format` : `CHECK (residence_country IS NULL OR residence_country ~ '^[A-Z]{2}$'::text)`
- `user_account_status_valid` : `CHECK (status = ANY (ARRAY['PENDING_EMAIL'::text, 'ACTIVE'::text, 'RESTRICTED'::text, 'CLOSED'::text, 'BANNED'::text]))`

Index :

- `user_account_phone_verified_unique` : `CREATE UNIQUE INDEX user_account_phone_verified_unique ON core.iam_user_account USING btree (phone_e164) WHERE (phone_verified_at IS NOT NULL)`

Politiques RLS :

- `cmd_golive_sel` (SELECT, PERMISSIVE, cmd_golive_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_param_sel` (SELECT, PERMISSIVE, cmd_param_owner) USING `true`
- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `(status = 'PENDING_EMAIL'::text)`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(status = ANY (ARRAY['PENDING_EMAIL'::text, 'ACTIVE'::text, 'RESTRICTED'::text]))` WITH CHECK `((status = ANY (ARRAY['ACTIVE'::text, 'RESTRICTED'::text])) AND (email_verified_at IS NOT NULL))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_name_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `((pseudonymized_at IS NULL) AND (status = ANY (ARRAY['ACTIVE'::text, 'RESTRICTED'::text])))` WITH CHECK `((pseudonymized_at IS NULL) AND (status = ANY (ARRAY['ACTIVE'::text, 'RESTRICTED'::text])))`
- `kyc_cmd_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `messaging_cmd_read` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`
- `review_cmd_read` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `true`
- `user_account_self_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (id = app.actor_id()))`

Déclencheurs :

- `ctr_signup_consents_required` : `CREATE CONSTRAINT TRIGGER ctr_signup_consents_required AFTER INSERT ON core.iam_user_account DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NOT core.ctr_writer_exempt()) EXECUTE FUNCTION core.ctr_signup_consents_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_user_account FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.kyc_entry_declaration`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `user_id` | `uuid` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `residency_status` | `text` | oui | — |
| `entry_date` | `date` | non | — |
| `declared_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `kyc_entry_declaration_country_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `kyc_entry_declaration_pkey` : `PRIMARY KEY (id)`
- `kyc_entry_declaration_residency_valid` : `CHECK (residency_status = ANY (ARRAY['TOURIST'::text, 'RESIDENT'::text]))`
- `kyc_entry_declaration_tourist_entry` : `CHECK (residency_status = 'RESIDENT'::text OR entry_date IS NOT NULL)`
- `kyc_entry_declaration_user_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `kyc_entry_declaration_user_idx` : `CREATE INDEX kyc_entry_declaration_user_idx ON core.kyc_entry_declaration USING btree (user_id, country_code, declared_at DESC)`

Politiques RLS :

- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.kyc_erasure_request`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `user_id` | `uuid` | oui | — |
| `verification_id` | `uuid` | oui | — |
| `provider` | `text` | oui | — |
| `provider_session_ref` | `text` | non | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `attestation_ref` | `text` | non | — |
| `requested_at` | `timestamp with time zone` | oui | `platform.now()` |
| `completed_at` | `timestamp with time zone` | non | — |

Contraintes :

- `kyc_erasure_request_attestation_length` : `CHECK (attestation_ref IS NULL OR length(attestation_ref) >= 1 AND length(attestation_ref) <= 200)`
- `kyc_erasure_request_done_coherent` : `CHECK (status = 'PENDING'::text AND completed_at IS NULL AND provider_session_ref IS NOT NULL OR status = 'FAILED'::text AND completed_at IS NOT NULL AND provider_session_ref IS NOT NULL OR status = 'DONE'::text AND completed_at IS NOT NULL AND provider_session_ref IS NULL)`
- `kyc_erasure_request_pkey` : `PRIMARY KEY (id)`
- `kyc_erasure_request_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_erasure_request_session_ref_length` : `CHECK (provider_session_ref IS NULL OR length(provider_session_ref) >= 1 AND length(provider_session_ref) <= 200)`
- `kyc_erasure_request_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'DONE'::text, 'FAILED'::text]))`
- `kyc_erasure_request_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `kyc_erasure_request_verification_id_fkey` : `FOREIGN KEY (verification_id) REFERENCES core.kyc_identity_verification(id)`

Index :

- `kyc_erasure_request_user_idx` : `CREATE INDEX kyc_erasure_request_user_idx ON core.kyc_erasure_request USING btree (user_id, status)`

Politiques RLS :

- `kyc_cmd_erasure_reopen` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(status = 'FAILED'::text)` WITH CHECK `((status = 'PENDING'::text) AND (completed_at IS NULL))`
- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `(status = 'PENDING'::text)`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(status = 'PENDING'::text)` WITH CHECK `(status = ANY (ARRAY['DONE'::text, 'FAILED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

### `core.kyc_host_tax_profile`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `org_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `tax_id_kind` | `text` | oui | — |
| `tax_id_enc` | `bytea` | oui | — |
| `tax_id_key_subject_type` | `text` | oui | `'ORG'::text` |
| `tax_id_key_subject_id` | `uuid` | oui | — |
| `regime` | `text` | non | — |
| `taxpayer_kind` | `text` | oui | `'INDIVIDUAL'::text` |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `kyc_host_tax_profile_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `kyc_host_tax_profile_envelope` : `CHECK (octet_length(tax_id_enc) >= 30 AND octet_length(tax_id_enc) <= 128 AND get_byte(tax_id_enc, 0) = 1)`
- `kyc_host_tax_profile_individual` : `CHECK (taxpayer_kind = 'INDIVIDUAL'::text)`
- `kyc_host_tax_profile_key_is_org` : `CHECK (tax_id_key_subject_id = org_id)`
- `kyc_host_tax_profile_key_type_valid` : `CHECK (tax_id_key_subject_type = 'ORG'::text)`
- `kyc_host_tax_profile_kind_format` : `CHECK (tax_id_kind ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_host_tax_profile_org_fk` : `FOREIGN KEY (org_id, user_id) REFERENCES core.iam_organization(id, holder_user_id)`
- `kyc_host_tax_profile_org_unique` : `UNIQUE (org_id)`
- `kyc_host_tax_profile_pkey` : `PRIMARY KEY (id)`
- `kyc_host_tax_profile_regime_format` : `CHECK (regime IS NULL OR regime ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_host_tax_profile_row_version_valid` : `CHECK (row_version >= 0)`
- `kyc_host_tax_profile_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Politiques RLS :

- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.kyc_host_verification`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `org_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | — |
| `screening_hold` | `boolean` | oui | `false` |
| `identity_verification_id` | `uuid` | non | — |
| `age_ok` | `boolean` | oui | `false` |
| `residence_verified` | `boolean` | oui | `false` |
| `tax_id_checked_at` | `timestamp with time zone` | non | — |
| `sanctions_screening_id` | `uuid` | non | — |
| `missing` | `text[]` | oui | `'{}'::text[]` |
| `reason_code` | `text` | non | — |
| `decided_by` | `uuid` | non | — |
| `decided_at` | `timestamp with time zone` | non | — |
| `activated_at` | `timestamp with time zone` | non | — |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `review_started_at` | `timestamp with time zone` | non | — |
| `auto_review_attempted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `kyc_host_verification_activated_approved` : `CHECK (activated_at IS NULL OR status = 'APPROVED'::text)`
- `kyc_host_verification_approved_complete` : `CHECK (status <> 'APPROVED'::text OR age_ok AND cardinality(missing) = 0 AND identity_verification_id IS NOT NULL AND sanctions_screening_id IS NOT NULL)`
- `kyc_host_verification_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `kyc_host_verification_decided_by_fkey` : `FOREIGN KEY (decided_by) REFERENCES core.iam_user_account(id)`
- `kyc_host_verification_decided_coherent` : `CHECK ((status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'REVOKED'::text])) = (decided_at IS NOT NULL))`
- `kyc_host_verification_hold_not_approved` : `CHECK (NOT screening_hold OR status <> 'APPROVED'::text)`
- `kyc_host_verification_hold_reason` : `CHECK (NOT screening_hold OR reason_code IS NOT NULL)`
- `kyc_host_verification_identity_verification_id_fkey` : `FOREIGN KEY (identity_verification_id) REFERENCES core.kyc_identity_verification(id)`
- `kyc_host_verification_missing_valid` : `CHECK (array_position(missing, NULL::text) IS NULL AND missing <@ ARRAY['HOST_SCREENING_MISSING'::text, 'HOST_TAX_ID_REQUIRED'::text, 'TERMS_REACCEPT_REQUIRED'::text, 'HOST_KYC_REQUIRED'::text])`
- `kyc_host_verification_org_fk` : `FOREIGN KEY (org_id, user_id) REFERENCES core.iam_organization(id, holder_user_id)`
- `kyc_host_verification_org_unique` : `UNIQUE (org_id)`
- `kyc_host_verification_pkey` : `PRIMARY KEY (id)`
- `kyc_host_verification_reason_format` : `CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `kyc_host_verification_row_version_valid` : `CHECK (row_version >= 0)`
- `kyc_host_verification_screening_fk` : `FOREIGN KEY (sanctions_screening_id) REFERENCES core.kyc_sanctions_screening(id)`
- `kyc_host_verification_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'DOCS_PENDING'::text, 'IN_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text, 'REVOKED'::text]))`
- `kyc_host_verification_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `kyc_host_verification_user_idx` : `CREATE INDEX kyc_host_verification_user_idx ON core.kyc_host_verification USING btree (user_id)`

Politiques RLS :

- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((status = ANY (ARRAY['OPEN'::text, 'DOCS_PENDING'::text, 'IN_REVIEW'::text])) AND (decided_at IS NULL) AND (activated_at IS NULL))`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(status <> ALL (ARRAY['REJECTED'::text, 'REVOKED'::text]))` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_host_duplicate_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `(status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'REVOKED'::text]))`

### `core.kyc_identity_document`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `verification_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `attempt` | `integer` | oui | — |
| `doc_type` | `text` | oui | — |
| `issuing_country` | `character(2)` | oui | — |
| `expiry_date` | `date` | non | — |
| `license_class` | `text` | non | — |
| `is_permanent` | `boolean` | non | — |
| `provider_document_ref` | `text` | non | — |
| `status` | `text` | oui | — |
| `retention_until` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `holder_given_names` | `text` | non | — |
| `holder_surnames` | `text` | non | — |
| `name_match` | `text` | non | — |

Contraintes :

- `kyc_identity_document_attempt_positive` : `CHECK (attempt >= 1)`
- `kyc_identity_document_class_length` : `CHECK (license_class IS NULL OR length(license_class) >= 1 AND length(license_class) <= 20)`
- `kyc_identity_document_country_format` : `CHECK (issuing_country ~ '^[A-Z]{2}$'::text)`
- `kyc_identity_document_given_names_length` : `CHECK (holder_given_names IS NULL OR char_length(holder_given_names) >= 1 AND char_length(holder_given_names) <= 200)`
- `kyc_identity_document_name_match_valid` : `CHECK (name_match IS NULL OR (name_match = ANY (ARRAY['MATCH'::text, 'MISMATCH'::text, 'MISSING'::text])))`
- `kyc_identity_document_pkey` : `PRIMARY KEY (id)`
- `kyc_identity_document_ref_length` : `CHECK (provider_document_ref IS NULL OR length(provider_document_ref) >= 1 AND length(provider_document_ref) <= 200)`
- `kyc_identity_document_status_valid` : `CHECK (status = ANY (ARRAY['ACCEPTED'::text, 'IN_REVIEW'::text]))`
- `kyc_identity_document_surnames_length` : `CHECK (holder_surnames IS NULL OR char_length(holder_surnames) >= 1 AND char_length(holder_surnames) <= 200)`
- `kyc_identity_document_type_valid` : `CHECK (doc_type = ANY (ARRAY['DRIVER_LICENSE'::text, 'NATIONAL_ID'::text, 'FOREIGN_RESIDENT_ID'::text, 'PASSPORT'::text, 'IDP'::text]))`
- `kyc_identity_document_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `kyc_identity_document_verification_id_fkey` : `FOREIGN KEY (verification_id) REFERENCES core.kyc_identity_verification(id)`

Index :

- `kyc_identity_document_verification_idx` : `CREATE INDEX kyc_identity_document_verification_idx ON core.kyc_identity_document USING btree (verification_id, attempt)`

Politiques RLS :

- `kyc_cmd_accept` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(status = 'IN_REVIEW'::text)` WITH CHECK `(status = 'ACCEPTED'::text)`
- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(provider_document_ref IS NOT NULL)` WITH CHECK `(provider_document_ref IS NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `((holder_given_names IS NOT NULL) AND (holder_surnames IS NOT NULL))`

### `core.kyc_identity_subject`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `verification_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `attempt` | `integer` | oui | — |
| `date_of_birth` | `date` | non | — |
| `residence_country` | `character(2)` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `kyc_identity_subject_attempt_positive` : `CHECK (attempt >= 1)`
- `kyc_identity_subject_attempt_unique` : `UNIQUE (verification_id, attempt)`
- `kyc_identity_subject_birth_range` : `CHECK (date_of_birth IS NULL OR date_of_birth >= '1900-01-01'::date)`
- `kyc_identity_subject_pkey` : `PRIMARY KEY (id)`
- `kyc_identity_subject_residence_format` : `CHECK (residence_country IS NULL OR residence_country ~ '^[A-Z]{2}$'::text)`
- `kyc_identity_subject_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `kyc_identity_subject_verification_id_fkey` : `FOREIGN KEY (verification_id) REFERENCES core.kyc_identity_verification(id)`

Index :

- `kyc_identity_subject_user_idx` : `CREATE INDEX kyc_identity_subject_user_idx ON core.kyc_identity_subject USING btree (user_id)`

Politiques RLS :

- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `(date_of_birth IS NOT NULL)`

### `core.kyc_identity_verification`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `user_id` | `uuid` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `status` | `text` | oui | — |
| `is_current` | `boolean` | oui | `true` |
| `attempt` | `integer` | oui | `1` |
| `provider` | `text` | non | — |
| `provider_session_ref` | `text` | non | — |
| `hosted_url` | `text` | non | — |
| `session_expires_at` | `timestamp with time zone` | non | — |
| `decision_reason_code` | `text` | non | — |
| `reviewed_by` | `uuid` | non | — |
| `approved_at` | `timestamp with time zone` | non | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `review_unqueued_at` | `timestamp with time zone` | non | — |
| `first_approved_at` | `timestamp with time zone` | non | — |

Contraintes :

- `kyc_identity_verification_approved_coherent` : `CHECK (status <> 'APPROVED'::text OR approved_at IS NOT NULL AND expires_at IS NOT NULL)`
- `kyc_identity_verification_attempt_positive` : `CHECK (attempt >= 1)`
- `kyc_identity_verification_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `kyc_identity_verification_hosted_url_format` : `CHECK (hosted_url IS NULL OR hosted_url ~ '^https://'::text AND length(hosted_url) <= 500)`
- `kyc_identity_verification_pkey` : `PRIMARY KEY (id)`
- `kyc_identity_verification_provider_format` : `CHECK (provider IS NULL OR provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_identity_verification_reason_format` : `CHECK (decision_reason_code IS NULL OR decision_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `kyc_identity_verification_reviewed_by_fkey` : `FOREIGN KEY (reviewed_by) REFERENCES core.iam_user_account(id)`
- `kyc_identity_verification_row_version_valid` : `CHECK (row_version >= 0)`
- `kyc_identity_verification_session_pair` : `CHECK ((provider_session_ref IS NULL) = (session_expires_at IS NULL))`
- `kyc_identity_verification_session_provider` : `CHECK (provider_session_ref IS NULL OR provider IS NOT NULL)`
- `kyc_identity_verification_session_ref_length` : `CHECK (provider_session_ref IS NULL OR length(provider_session_ref) >= 1 AND length(provider_session_ref) <= 200)`
- `kyc_identity_verification_status_valid` : `CHECK (status = ANY (ARRAY['NOT_STARTED'::text, 'PHONE_VERIFIED'::text, 'DOCS_SUBMITTED'::text, 'AUTO_CHECKS'::text, 'MANUAL_REVIEW'::text, 'MORE_INFO_REQUIRED'::text, 'APPROVED'::text, 'RECHECK'::text, 'EXPIRED'::text, 'REVOKED'::text, 'REJECTED'::text, 'APPEAL'::text, 'REJECTED_FINAL'::text, 'BANNED'::text]))`
- `kyc_identity_verification_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `kyc_identity_verification_approved_user_idx` : `CREATE INDEX kyc_identity_verification_approved_user_idx ON core.kyc_identity_verification USING btree (user_id) WHERE (first_approved_at IS NOT NULL)`
- `kyc_identity_verification_current_unique` : `CREATE UNIQUE INDEX kyc_identity_verification_current_unique ON core.kyc_identity_verification USING btree (user_id) WHERE is_current`
- `kyc_identity_verification_session_unique` : `CREATE UNIQUE INDEX kyc_identity_verification_session_unique ON core.kyc_identity_verification USING btree (provider, provider_session_ref) WHERE (provider_session_ref IS NOT NULL)`

Politiques RLS :

- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `(is_current AND (status = 'PHONE_VERIFIED'::text) AND (provider_session_ref IS NULL) AND (approved_at IS NULL) AND (reviewed_by IS NULL))`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `is_current` WITH CHECK `is_current`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `(approved_at IS NOT NULL)`
- `risk_link_read_once` (SELECT, PERMISSIVE, risk_limit_owner) USING `(first_approved_at IS NOT NULL)`

Déclencheurs :

- `kyc_first_approved_keep` : `CREATE TRIGGER kyc_first_approved_keep BEFORE INSERT OR UPDATE ON core.kyc_identity_verification FOR EACH ROW EXECUTE FUNCTION core.kyc_first_approved_keep()`
- `kyc_verification_review_queue` : `CREATE TRIGGER kyc_verification_review_queue AFTER UPDATE OF status ON core.kyc_identity_verification FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION core.kyc_verification_review_queue()`

### `core.kyc_liveness_check`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `verification_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `attempt` | `integer` | oui | — |
| `liveness_score` | `numeric(5,4)` | non | — |
| `face_match_score` | `numeric(5,4)` | non | — |
| `result` | `text` | oui | — |
| `provider_session_ref` | `text` | non | — |
| `retention_until` | `timestamp with time zone` | oui | — |
| `erased_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `kyc_liveness_check_attempt_positive` : `CHECK (attempt >= 1)`
- `kyc_liveness_check_erased_coherent` : `CHECK (erased_at IS NULL AND provider_session_ref IS NOT NULL OR erased_at IS NOT NULL AND liveness_score IS NULL AND face_match_score IS NULL AND provider_session_ref IS NULL)`
- `kyc_liveness_check_face_range` : `CHECK (face_match_score IS NULL OR face_match_score >= 0::numeric AND face_match_score <= 1::numeric)`
- `kyc_liveness_check_liveness_range` : `CHECK (liveness_score IS NULL OR liveness_score >= 0::numeric AND liveness_score <= 1::numeric)`
- `kyc_liveness_check_pkey` : `PRIMARY KEY (id)`
- `kyc_liveness_check_result_valid` : `CHECK (result = ANY (ARRAY['APPROVED'::text, 'DECLINED'::text, 'REVIEW'::text]))`
- `kyc_liveness_check_session_ref_length` : `CHECK (provider_session_ref IS NULL OR length(provider_session_ref) >= 1 AND length(provider_session_ref) <= 200)`
- `kyc_liveness_check_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `kyc_liveness_check_verification_id_fkey` : `FOREIGN KEY (verification_id) REFERENCES core.kyc_identity_verification(id)`

Index :

- `kyc_liveness_check_retention_idx` : `CREATE INDEX kyc_liveness_check_retention_idx ON core.kyc_liveness_check USING btree (retention_until) WHERE (erased_at IS NULL)`
- `kyc_liveness_check_verification_idx` : `CREATE INDEX kyc_liveness_check_verification_idx ON core.kyc_liveness_check USING btree (verification_id)`

Politiques RLS :

- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(erased_at IS NULL)` WITH CHECK `(erased_at IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.kyc_provider_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `provider` | `text` | oui | — |
| `event_id` | `text` | oui | — |
| `session_ref` | `text` | oui | — |
| `decision` | `text` | oui | — |
| `outcome` | `text` | non | — |
| `received_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `kyc_provider_event_decision_valid` : `CHECK (decision = ANY (ARRAY['APPROVED'::text, 'DECLINED'::text, 'REVIEW'::text]))`
- `kyc_provider_event_event_id_length` : `CHECK (length(event_id) >= 1 AND length(event_id) <= 200)`
- `kyc_provider_event_outcome_valid` : `CHECK (outcome IS NULL OR (outcome = ANY (ARRAY['APPLIED'::text, 'STALE'::text, 'CONSENT_WITHDRAWN'::text])))`
- `kyc_provider_event_pkey` : `PRIMARY KEY (id)`
- `kyc_provider_event_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_provider_event_session_ref_length` : `CHECK (length(session_ref) >= 1 AND length(session_ref) <= 200)`
- `kyc_provider_event_unique` : `UNIQUE (provider, event_id)`

Politiques RLS :

- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `(outcome IS NULL)`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `kyc_cmd_update` (UPDATE, PERMISSIVE, kyc_cmd_owner) USING `(outcome IS NULL)` WITH CHECK `(outcome IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.kyc_sanctions_screening`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `subject_type` | `text` | oui | `'PERSON'::text` |
| `subject_id` | `uuid` | oui | — |
| `host_verification_id` | `uuid` | oui | — |
| `provider` | `text` | oui | — |
| `request_key` | `text` | oui | — |
| `lists_version` | `jsonb` | oui | — |
| `result` | `text` | oui | — |
| `match_ref` | `text` | non | — |
| `screened_at` | `timestamp with time zone` | oui | — |
| `reviewer` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `manual_action_id` | `uuid` | non | — |

Contraintes :

- `kyc_sanctions_screening_host_verification_id_fkey` : `FOREIGN KEY (host_verification_id) REFERENCES core.kyc_host_verification(id)`
- `kyc_sanctions_screening_lists_object` : `CHECK (jsonb_typeof(lists_version) = 'object'::text)`
- `kyc_sanctions_screening_manual_action_fk` : `FOREIGN KEY (manual_action_id) REFERENCES core.support_manual_action(id) DEFERRABLE INITIALLY DEFERRED`
- `kyc_sanctions_screening_manual_coherent` : `CHECK ((provider = 'OPS_MANUAL'::text) = (manual_action_id IS NOT NULL) AND (provider <> 'OPS_MANUAL'::text OR reviewer IS NOT NULL))`
- `kyc_sanctions_screening_match_ref_coherent` : `CHECK (result <> 'CLEAR'::text OR match_ref IS NULL)`
- `kyc_sanctions_screening_match_ref_format` : `CHECK (match_ref IS NULL OR match_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `kyc_sanctions_screening_pkey` : `PRIMARY KEY (id)`
- `kyc_sanctions_screening_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_sanctions_screening_request_key_format` : `CHECK (request_key ~ '^screening:[0-9a-f-]{36}:a[1-9][0-9]{0,2}$'::text)`
- `kyc_sanctions_screening_request_unique` : `UNIQUE (provider, request_key)`
- `kyc_sanctions_screening_result_valid` : `CHECK (result = ANY (ARRAY['CLEAR'::text, 'POTENTIAL_MATCH'::text, 'CONFIRMED_MATCH'::text]))`
- `kyc_sanctions_screening_reviewer_fkey` : `FOREIGN KEY (reviewer) REFERENCES core.iam_user_account(id)`
- `kyc_sanctions_screening_subject_id_fkey` : `FOREIGN KEY (subject_id) REFERENCES core.iam_user_account(id)`
- `kyc_sanctions_screening_subject_type_valid` : `CHECK (subject_type = 'PERSON'::text)`

Index :

- `kyc_sanctions_screening_dossier_idx` : `CREATE INDEX kyc_sanctions_screening_dossier_idx ON core.kyc_sanctions_screening USING btree (host_verification_id, created_at)`

Politiques RLS :

- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.kyc_webhook_rejection`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : kyc_cmd_owner: DELETE, INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `provider` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `body_sha256` | `bytea` | oui | — |
| `body_length` | `integer` | oui | — |
| `received_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `kyc_webhook_rejection_length_valid` : `CHECK (body_length >= 0)`
- `kyc_webhook_rejection_pkey` : `PRIMARY KEY (id)`
- `kyc_webhook_rejection_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `kyc_webhook_rejection_reason_valid` : `CHECK (reason = ANY (ARRAY['BAD_SIGNATURE'::text, 'STALE'::text, 'MALFORMED'::text]))`
- `kyc_webhook_rejection_sha256` : `CHECK (octet_length(body_sha256) = 32)`

Index :

- `kyc_webhook_rejection_received_idx` : `CREATE INDEX kyc_webhook_rejection_received_idx ON core.kyc_webhook_rejection USING btree (provider, received_at)`

Politiques RLS :

- `kyc_cmd_delete` (DELETE, PERMISSIVE, kyc_cmd_owner) USING `(received_at < (platform.now() - make_interval(days => 90)))`
- `kyc_cmd_insert` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `true`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.messaging_meeting_proposal`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : messaging_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `proposed_by` | `uuid` | oui | — |
| `proposer_role` | `text` | oui | — |
| `place_label` | `text` | non | — |
| `meet_at` | `timestamp with time zone` | oui | — |
| `status` | `text` | oui | — |
| `answered_by` | `uuid` | non | — |
| `answered_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `purged_at` | `timestamp with time zone` | non | — |
| `offplatform_codes` | `text[]` | non | — |
| `review_item_id` | `uuid` | non | — |

Contraintes :

- `messaging_meeting_answer_after` : `CHECK (answered_at IS NULL OR answered_at >= created_at)`
- `messaging_meeting_answer_shape` : `CHECK ((answered_by IS NULL) = (answered_at IS NULL) AND (status <> 'PROPOSED'::text OR answered_by IS NULL) AND ((status <> ALL (ARRAY['ACCEPTED'::text, 'DECLINED'::text])) OR answered_by IS NOT NULL))`
- `messaging_meeting_flag_shape` : `CHECK ((offplatform_codes IS NULL) = (review_item_id IS NULL))`
- `messaging_meeting_kind_valid` : `CHECK (kind = ANY (ARRAY['PICKUP'::text, 'RETURN'::text]))`
- `messaging_meeting_offplatform_codes` : `CHECK (offplatform_codes IS NULL OR cardinality(offplatform_codes) >= 1 AND cardinality(offplatform_codes) <= 32 AND array_to_string(offplatform_codes, ','::text) ~ '^[A-Z][A-Z0-9_]{1,63}(,[A-Z][A-Z0-9_]{1,63})*$'::text)`
- `messaging_meeting_place_length` : `CHECK (char_length(place_label) >= 3 AND char_length(place_label) <= 160)`
- `messaging_meeting_proposal_answered_by_fkey` : `FOREIGN KEY (answered_by) REFERENCES core.iam_user_account(id)`
- `messaging_meeting_proposal_pkey` : `PRIMARY KEY (id)`
- `messaging_meeting_proposal_proposed_by_fkey` : `FOREIGN KEY (proposed_by) REFERENCES core.iam_user_account(id)`
- `messaging_meeting_proposal_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `messaging_meeting_proposer_valid` : `CHECK (proposer_role = ANY (ARRAY['HOST'::text, 'CO_HOST'::text]))`
- `messaging_meeting_purge_shape` : `CHECK (purged_at IS NULL AND place_label IS NOT NULL OR purged_at IS NOT NULL AND place_label IS NULL AND purged_at >= created_at)`
- `messaging_meeting_status_valid` : `CHECK (status = ANY (ARRAY['PROPOSED'::text, 'ACCEPTED'::text, 'DECLINED'::text, 'SUPERSEDED'::text]))`

Index :

- `messaging_meeting_one_accepted` : `CREATE UNIQUE INDEX messaging_meeting_one_accepted ON core.messaging_meeting_proposal USING btree (trip_id, kind) WHERE (status = 'ACCEPTED'::text)`
- `messaging_meeting_one_pending` : `CREATE UNIQUE INDEX messaging_meeting_one_pending ON core.messaging_meeting_proposal USING btree (trip_id, kind) WHERE (status = 'PROPOSED'::text)`
- `messaging_meeting_trip_idx` : `CREATE INDEX messaging_meeting_trip_idx ON core.messaging_meeting_proposal USING btree (trip_id, created_at, id)`

Politiques RLS :

- `messaging_cmd_ins` (INSERT, PERMISSIVE, messaging_cmd_owner) WITH CHECK `((status = 'PROPOSED'::text) AND (purged_at IS NULL))`
- `messaging_cmd_sel` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `messaging_cmd_upd` (UPDATE, PERMISSIVE, messaging_cmd_owner) USING `(purged_at IS NULL)` WITH CHECK `(status = ANY (ARRAY['ACCEPTED'::text, 'DECLINED'::text, 'SUPERSEDED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_purge` (UPDATE, PERMISSIVE, privacy_cmd_owner) USING `(purged_at IS NULL)` WITH CHECK `(purged_at IS NOT NULL)`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

Déclencheurs :

- `messaging_meeting_proposal_guard` : `CREATE TRIGGER messaging_meeting_proposal_guard BEFORE DELETE OR UPDATE ON core.messaging_meeting_proposal FOR EACH ROW EXECUTE FUNCTION core.messaging_meeting_guard()`
- `messaging_meeting_proposal_no_truncate` : `CREATE TRIGGER messaging_meeting_proposal_no_truncate BEFORE TRUNCATE ON core.messaging_meeting_proposal FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_meeting_guard()`

### `core.messaging_message`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : messaging_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `thread_id` | `uuid` | oui | — |
| `author_user_id` | `uuid` | oui | — |
| `author_role` | `text` | oui | — |
| `body` | `text` | non | — |
| `body_masked` | `text` | non | — |
| `channel_origin` | `text` | oui | `'IN_APP'::text` |
| `status` | `text` | oui | — |
| `sent_at` | `timestamp with time zone` | oui | `platform.now()` |
| `hidden_at` | `timestamp with time zone` | non | — |
| `purged_at` | `timestamp with time zone` | non | — |

Contraintes :

- `messaging_message_author_role_valid` : `CHECK (author_role = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'CO_HOST'::text]))`
- `messaging_message_author_user_id_fkey` : `FOREIGN KEY (author_user_id) REFERENCES core.iam_user_account(id)`
- `messaging_message_body_length` : `CHECK (char_length(body) >= 1 AND char_length(body) <= 2000)`
- `messaging_message_body_masked_length` : `CHECK (char_length(body_masked) >= 1 AND char_length(body_masked) <= 4000)`
- `messaging_message_channel_valid` : `CHECK (channel_origin = ANY (ARRAY['IN_APP'::text, 'WHATSAPP_RELAY'::text]))`
- `messaging_message_hidden_after_sent` : `CHECK (hidden_at IS NULL OR hidden_at >= sent_at)`
- `messaging_message_pkey` : `PRIMARY KEY (id)`
- `messaging_message_purge_shape` : `CHECK (purged_at IS NULL AND body IS NOT NULL AND body_masked IS NOT NULL OR purged_at IS NOT NULL AND body IS NULL AND body_masked IS NULL AND purged_at >= sent_at)`
- `messaging_message_status_valid` : `CHECK (status = ANY (ARRAY['SENT'::text, 'FLAGGED'::text]))`
- `messaging_message_thread_id_fkey` : `FOREIGN KEY (thread_id) REFERENCES core.messaging_message_thread(id)`

Index :

- `messaging_message_thread_idx` : `CREATE INDEX messaging_message_thread_idx ON core.messaging_message USING btree (thread_id, sent_at, id)`

Politiques RLS :

- `messaging_cmd_ins` (INSERT, PERMISSIVE, messaging_cmd_owner) WITH CHECK `((hidden_at IS NULL) AND (channel_origin = 'IN_APP'::text))`
- `messaging_cmd_sel` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_purge` (UPDATE, PERMISSIVE, privacy_cmd_owner) USING `(purged_at IS NULL)` WITH CHECK `(purged_at IS NOT NULL)`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

Déclencheurs :

- `messaging_message_guard` : `CREATE TRIGGER messaging_message_guard BEFORE DELETE OR UPDATE ON core.messaging_message FOR EACH ROW EXECUTE FUNCTION core.messaging_record_guard()`
- `messaging_message_no_truncate` : `CREATE TRIGGER messaging_message_no_truncate BEFORE TRUNCATE ON core.messaging_message FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_record_guard()`

### `core.messaging_message_flag`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : messaging_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `message_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `matched` | `text[]` | oui | — |
| `review_item_id` | `uuid` | oui | — |
| `reviewed_by` | `uuid` | non | — |
| `outcome` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `messaging_message_flag_kind_valid` : `CHECK (kind = ANY (ARRAY['CONTACT_MASKED'::text, 'GRAY_MARKET_KEYWORD'::text, 'ABUSE'::text]))`
- `messaging_message_flag_matched_codes` : `CHECK (cardinality(matched) >= 1 AND cardinality(matched) <= 32 AND array_to_string(matched, ','::text) ~ '^[A-Z][A-Z0-9_]{1,63}(,[A-Z][A-Z0-9_]{1,63})*$'::text)`
- `messaging_message_flag_message_id_fkey` : `FOREIGN KEY (message_id) REFERENCES core.messaging_message(id)`
- `messaging_message_flag_once` : `UNIQUE (message_id, kind)`
- `messaging_message_flag_outcome_valid` : `CHECK (outcome IS NULL OR (outcome = ANY (ARRAY['CONFIRMED'::text, 'DISMISSED'::text])))`
- `messaging_message_flag_pkey` : `PRIMARY KEY (id)`
- `messaging_message_flag_review_shape` : `CHECK ((reviewed_by IS NULL) = (outcome IS NULL))`

Politiques RLS :

- `messaging_cmd_ins` (INSERT, PERMISSIVE, messaging_cmd_owner) WITH CHECK `((reviewed_by IS NULL) AND (outcome IS NULL) AND (kind <> 'ABUSE'::text))`
- `messaging_cmd_sel` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `messaging_message_flag_guard` : `CREATE TRIGGER messaging_message_flag_guard BEFORE DELETE OR UPDATE ON core.messaging_message_flag FOR EACH ROW EXECUTE FUNCTION core.messaging_record_guard()`
- `messaging_message_flag_no_truncate` : `CREATE TRIGGER messaging_message_flag_no_truncate BEFORE TRUNCATE ON core.messaging_message_flag FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_record_guard()`

### `core.messaging_message_thread`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : messaging_cmd_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `messaging_message_thread_pkey` : `PRIMARY KEY (id)`
- `messaging_message_thread_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `messaging_message_thread_trip_unique` : `UNIQUE (trip_id)`

Politiques RLS :

- `messaging_cmd_ins` (INSERT, PERMISSIVE, messaging_cmd_owner) WITH CHECK `true`
- `messaging_cmd_sel` (SELECT, PERMISSIVE, messaging_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`

Déclencheurs :

- `messaging_message_thread_guard` : `CREATE TRIGGER messaging_message_thread_guard BEFORE DELETE OR UPDATE ON core.messaging_message_thread FOR EACH ROW EXECUTE FUNCTION core.messaging_record_guard()`
- `messaging_message_thread_no_truncate` : `CREATE TRIGGER messaging_message_thread_no_truncate BEFORE TRUNCATE ON core.messaging_message_thread FOR EACH STATEMENT EXECUTE FUNCTION core.messaging_record_guard()`

### `core.ntf_notification_dispatch`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : aucun

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `event_id` | `uuid` | oui | — |
| `event_type` | `text` | oui | — |
| `country_code` | `text` | non | — |
| `correlation_id` | `uuid` | oui | — |
| `recipient_user_id` | `uuid` | oui | — |
| `recipient_role` | `text` | oui | — |
| `channel` | `text` | oui | — |
| `template_key` | `text` | oui | — |
| `template_version` | `integer` | oui | — |
| `variables` | `jsonb` | oui | `'{}'::jsonb` |
| `status` | `text` | oui | `'QUEUED'::text` |
| `attempts` | `smallint` | oui | `0` |
| `locale` | `text` | non | — |
| `provider_message_id` | `text` | non | — |
| `rendered_hash` | `bytea` | non | — |
| `last_error` | `text` | non | — |
| `fallback_of` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `notification_dispatch_attempts_range` : `CHECK (attempts >= 0 AND attempts <= 3)`
- `notification_dispatch_channel_valid` : `CHECK (channel = ANY (ARRAY['EMAIL'::text, 'SMS'::text]))`
- `notification_dispatch_country_format` : `CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'::text)`
- `notification_dispatch_error_code` : `CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)`
- `notification_dispatch_event_type_format` : `CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text)`
- `notification_dispatch_hash_sha256` : `CHECK (rendered_hash IS NULL OR octet_length(rendered_hash) = 32)`
- `notification_dispatch_locale_format` : `CHECK (locale IS NULL OR locale ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)`
- `notification_dispatch_not_own_fallback` : `CHECK (fallback_of IS NULL OR fallback_of <> id)`
- `notification_dispatch_provider_ref` : `CHECK (provider_message_id IS NULL OR length(provider_message_id) >= 1 AND length(provider_message_id) <= 200)`
- `notification_dispatch_role_format` : `CHECK (recipient_role ~ '^[A-Z][A-Z0-9_]{0,31}$'::text)`
- `notification_dispatch_sent_has_ref` : `CHECK ((status <> ALL (ARRAY['SENT'::text, 'DELIVERED'::text])) OR provider_message_id IS NOT NULL AND rendered_hash IS NOT NULL)`
- `notification_dispatch_status_valid` : `CHECK (status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'DELIVERED'::text, 'FAILED'::text, 'FALLBACK_TRIGGERED'::text, 'SUPPRESSED'::text]))`
- `notification_dispatch_template_format` : `CHECK (template_key ~ '^EVT_[A-Z0-9_]{1,60}$'::text)`
- `notification_dispatch_template_version` : `CHECK (template_version >= 1)`
- `notification_dispatch_unique` : `UNIQUE (event_id, recipient_user_id, channel)`
- `notification_dispatch_variables_object` : `CHECK (jsonb_typeof(variables) = 'object'::text)`
- `ntf_notification_dispatch_fallback_of_fkey` : `FOREIGN KEY (fallback_of) REFERENCES core.ntf_notification_dispatch(id)`
- `ntf_notification_dispatch_pkey` : `PRIMARY KEY (id)`
- `ntf_notification_dispatch_recipient_user_id_fkey` : `FOREIGN KEY (recipient_user_id) REFERENCES core.iam_user_account(id)`

Index :

- `notification_dispatch_fallback_idx` : `CREATE INDEX notification_dispatch_fallback_idx ON core.ntf_notification_dispatch USING btree (fallback_of) WHERE (fallback_of IS NOT NULL)`
- `notification_dispatch_recipient_idx` : `CREATE INDEX notification_dispatch_recipient_idx ON core.ntf_notification_dispatch USING btree (recipient_user_id)`

Politiques RLS :

- `iam_auth_select_queued` (SELECT, PERMISSIVE, iam_auth_owner) USING `(status = 'QUEUED'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `ntf_sender_update` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'ntf_sender'::text) AND (status = 'QUEUED'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'ntf_sender'::text))`
- `ntf_worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['ntf_dispatcher'::text, 'ntf_sender'::text])) AND (status = 'QUEUED'::text) AND (attempts = 0) AND ((fallback_of IS NULL) OR (app.worker_name() = 'ntf_sender'::text)))`
- `ntf_worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['ntf_dispatcher'::text, 'ntf_sender'::text])))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.ntf_notification_dispatch FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.outbox_dead_letter`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `consumer` | `text` | oui | — |
| `event_id` | `uuid` | non | — |
| `job_id` | `uuid` | oui | — |
| `attempts` | `integer` | oui | — |
| `last_error` | `text` | non | — |
| `parked_at` | `timestamp with time zone` | oui | `platform.now()` |
| `replayed_at` | `timestamp with time zone` | non | — |
| `replayed_by` | `uuid` | non | — |

Contraintes :

- `dead_letter_attempts_positive` : `CHECK (attempts >= 1)`
- `dead_letter_consumer_format` : `CHECK (consumer ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `dead_letter_job_unique` : `UNIQUE (job_id)`
- `dead_letter_last_error_length` : `CHECK (length(last_error) <= 200)`
- `dead_letter_replay_shape` : `CHECK ((replayed_at IS NULL) = (replayed_by IS NULL))`
- `outbox_dead_letter_pkey` : `PRIMARY KEY (id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_own` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`
- `worker_select_monitor` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bus_monitor'::text))`
- `worker_select_own` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`

### `core.outbox_inbox_receipt`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `consumer` | `text` | oui | — |
| `event_id` | `uuid` | oui | — |
| `processed_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `inbox_receipt_consumer_format` : `CHECK (consumer ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `inbox_receipt_pkey` : `PRIMARY KEY (consumer, event_id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_own` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`
- `worker_select_own` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`

### `core.outbox_outbox_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `type` | `text` | oui | — |
| `schema_version` | `integer` | oui | — |
| `occurred_at` | `timestamp with time zone` | oui | `platform.now()` |
| `aggregate_type` | `text` | oui | — |
| `aggregate_id` | `uuid` | oui | — |
| `aggregate_version` | `bigint` | oui | — |
| `country_code` | `text` | non | — |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `correlation_id` | `uuid` | oui | — |
| `causation_id` | `uuid` | non | — |
| `payload` | `jsonb` | oui | — |
| `partition_key` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `published_at` | `timestamp with time zone` | non | — |
| `attempts` | `integer` | oui | `0` |
| `last_error` | `text` | non | — |

Contraintes :

- `outbox_event_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{0,31}$'::text)`
- `outbox_event_actor_shape` : `CHECK ((actor_role = 'SYSTEM'::text) = (actor_user_id IS NULL))`
- `outbox_event_aggregate_type_format` : `CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `outbox_event_aggregate_version_valid` : `CHECK (aggregate_version >= 0)`
- `outbox_event_attempts_valid` : `CHECK (attempts >= 0)`
- `outbox_event_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `outbox_event_last_error_length` : `CHECK (length(last_error) <= 200)`
- `outbox_event_partition_key_length` : `CHECK (length(partition_key) >= 1 AND length(partition_key) <= 200)`
- `outbox_event_payload_object` : `CHECK (jsonb_typeof(payload) = 'object'::text)`
- `outbox_event_schema_version_positive` : `CHECK (schema_version >= 1)`
- `outbox_event_type_format` : `CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text AND length(type) <= 120)`
- `outbox_outbox_event_pkey` : `PRIMARY KEY (id)`

Index :

- `outbox_event_unpublished_idx` : `CREATE INDEX outbox_event_unpublished_idx ON core.outbox_outbox_event USING btree (id) WHERE (published_at IS NULL)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `catalog_cmd_event_insert` (INSERT, PERMISSIVE, catalog_cmd_owner) WITH CHECK `((((type = 'catalog.addition_request.resolved'::text) AND (aggregate_type = 'catalog_addition_request'::text)) OR ((type = 'catalog.vehicle.released'::text) AND (aggregate_type = 'catalog_vehicle'::text))) AND (actor_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text])) AND (actor_user_id IS NOT NULL))`
- `cmd_golive_event_ins` (INSERT, PERMISSIVE, cmd_golive_owner) WITH CHECK `((type = 'config.param.changed'::text) AND (aggregate_type = 'param_value'::text) AND (actor_role = 'SUPERADMIN'::text) AND (actor_user_id IS NOT NULL))`
- `cmd_hold_contract_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'contract_document'::text) AND (((type = 'contract.document.generated'::text) AND (actor_role = 'SYSTEM'::text) AND (actor_user_id IS NULL)) OR ((type = 'contract.document.signed'::text) AND (actor_role = 'GUEST'::text) AND (actor_user_id IS NOT NULL))))`
- `cmd_hold_deposit_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'deposit_hold'::text) AND (type = 'deposit.decision.executed'::text) AND (actor_role = 'SYSTEM'::text) AND (actor_user_id IS NULL) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_hold_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'checkout_hold'::text) AND (type = ANY (ARRAY['booking.hold.created'::text, 'booking.hold.released'::text, 'booking.hold.release_deferred'::text, 'booking.hold.payment_in_flight'::text])) AND (app.actor_kind() = 'GUEST'::text) AND (actor_role = 'GUEST'::text) AND (actor_user_id = app.actor_id()))`
- `cmd_hold_request_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'checkout_hold'::text) AND (((app.actor_kind() = 'HOST'::text) AND (actor_role = 'HOST'::text) AND (actor_user_id = app.actor_id()) AND (type = ANY (ARRAY['booking.request.accepted'::text, 'booking.request.declined'::text, 'booking.request.access_denied'::text]))) OR ((app.actor_kind() = 'WORKER'::text) AND (actor_role = 'SYSTEM'::text) AND (app.worker_name() = ANY (ARRAY['hold_expiry'::text, 'booking_conversion'::text])) AND (type = ANY (ARRAY['booking.request.received'::text, 'booking.request.expired'::text, 'booking.request.void_requested'::text, 'booking.request.capture_unconfirmed'::text])))))`
- `cmd_hold_request_event_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `((type = 'booking.request.access_denied'::text) AND (actor_user_id = app.actor_id()))`
- `cmd_hold_review_event` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'checkout_hold'::text) AND (type = 'booking.hold.review_decided'::text) AND (actor_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text])) AND (actor_user_id IS NOT NULL))`
- `cmd_hold_trip_notice_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((type = ANY (ARRAY['booking.trip.host_restricted'::text, 'booking.trip.host_restriction_lifted'::text, 'trip.no_show.reported'::text])) AND (aggregate_type = 'trip'::text) AND (actor_user_id IS NOT NULL))`
- `cmd_money_incidental_event` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((type = 'invoice.status_changed'::text) AND (aggregate_type = 'incidental_invoice'::text) AND (actor_role = 'HOST'::text) AND (actor_user_id IS NOT NULL))`
- `cmd_param_event_ins` (INSERT, PERMISSIVE, cmd_param_owner) WITH CHECK `((type = 'config.param.changed'::text) AND (aggregate_type = 'param_value'::text) AND (actor_role = ANY (ARRAY['ADMIN'::text, 'SUPERADMIN'::text])) AND (actor_user_id IS NOT NULL))`
- `cmd_trip_escalation_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'trip'::text) AND (type = 'trip.overdue.escalated'::text) AND (actor_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text])) AND (app.actor_kind() = 'STAFF'::text) AND (actor_user_id = app.actor_id()))`
- `cmd_trip_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'trip'::text) AND (type = ANY (ARRAY['trip.status_changed'::text, 'trip.cancellation.qualified'::text])) AND (actor_role = 'SYSTEM'::text) AND (actor_user_id IS NULL))`
- `cmd_trip_overdue_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'trip'::text) AND (type = ANY (ARRAY['trip.overdue.detected'::text, 'trip.at_risk.flagged'::text])) AND (actor_role = 'SYSTEM'::text) AND (actor_user_id IS NULL) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))`
- `iam_auth_otp_event_ins` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((((type = 'iam.otp.requested'::text) AND (aggregate_type = 'otp_challenge'::text)) OR ((type = 'iam.phone.verified'::text) AND (aggregate_type = 'user_account'::text))) AND (actor_role = 'GUEST'::text) AND (actor_user_id IS NOT NULL))`
- `iam_staff_help_event` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((type = 'support.help_request.received'::text) AND (aggregate_type = 'support_case'::text) AND (actor_user_id IS NOT NULL) AND (actor_role = ANY (ARRAY['GUEST'::text, 'HOST'::text])))`
- `iam_staff_incident_event` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((type = 'security.incident.opened'::text) AND (aggregate_type = 'security_incident'::text) AND (actor_user_id IS NOT NULL) AND (actor_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text, 'SUPERADMIN'::text])))`
- `iam_staff_sla_event` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((type = 'support.review_queue.sla_breached'::text) AND (aggregate_type = 'review_queue_item'::text) AND (actor_role = 'SYSTEM'::text))`
- `kyc_cmd_event_ins` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((((type = 'kyc.verification.status_changed'::text) AND (aggregate_type = 'identity_verification'::text)) OR ((type = 'kyc.consent.withdrawn'::text) AND (aggregate_type = 'user_account'::text))) AND (actor_role = ANY (ARRAY['GUEST'::text, 'SYSTEM'::text])))`
- `kyc_cmd_event_ops` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((type = 'kyc.verification.status_changed'::text) AND (aggregate_type = 'identity_verification'::text) AND (actor_role = ANY (ARRAY['OPS_AGENT'::text, 'ADMIN'::text])) AND (actor_user_id IS NOT NULL))`
- `kyc_cmd_host_event_ins` (INSERT, PERMISSIVE, kyc_cmd_owner) WITH CHECK `((((type = ANY (ARRAY['kyc.host_verification.decided'::text, 'kyc.host_screening.flagged'::text])) AND (aggregate_type = 'host_verification'::text)) OR ((type = ANY (ARRAY['iam.organization.status_changed'::text, 'iam.organization.created'::text])) AND (aggregate_type = 'organization'::text))) AND (actor_role = ANY (ARRAY['GUEST'::text, 'OPS_AGENT'::text, 'ADMIN'::text, 'SYSTEM'::text])))`
- `messaging_cmd_meeting_event` (INSERT, PERMISSIVE, messaging_cmd_owner) WITH CHECK `((type = 'trip.meeting.confirmed'::text) AND (aggregate_type = 'trip'::text) AND (actor_role = 'GUEST'::text) AND (actor_user_id IS NOT NULL))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`
- `worker_select_monitor` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['bus_monitor'::text, 'ops_monitor'::text])))`
- `worker_select_relay` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'outbox_relay'::text))`
- `worker_update_relay` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'outbox_relay'::text) AND (published_at IS NULL))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'outbox_relay'::text))`

### `core.outbox_scheduled_job`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `name` | `text` | oui | — |
| `run_at` | `timestamp with time zone` | oui | `platform.now()` |
| `payload` | `jsonb` | oui | `'{}'::jsonb` |
| `singleton_key` | `text` | non | — |
| `event_id` | `uuid` | non | — |
| `state` | `text` | oui | `'CREATED'::text` |
| `attempts` | `integer` | oui | `0` |
| `max_attempts` | `integer` | oui | `5` |
| `locked_until` | `timestamp with time zone` | non | — |
| `last_error` | `text` | non | — |
| `completed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `outbox_scheduled_job_pkey` : `PRIMARY KEY (id)`
- `scheduled_job_active_is_leased` : `CHECK ((state = 'ACTIVE'::text) = (locked_until IS NOT NULL))`
- `scheduled_job_attempts_valid` : `CHECK (attempts >= 0 AND attempts <= max_attempts)`
- `scheduled_job_completed_at` : `CHECK ((state = 'COMPLETED'::text) = (completed_at IS NOT NULL))`
- `scheduled_job_last_error_length` : `CHECK (length(last_error) <= 200)`
- `scheduled_job_max_attempts_valid` : `CHECK (max_attempts >= 1 AND max_attempts <= 25)`
- `scheduled_job_name_format` : `CHECK (name ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `scheduled_job_payload_object` : `CHECK (jsonb_typeof(payload) = 'object'::text)`
- `scheduled_job_singleton_key_length` : `CHECK (length(singleton_key) >= 1 AND length(singleton_key) <= 200)`
- `scheduled_job_state_valid` : `CHECK (state = ANY (ARRAY['CREATED'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'FAILED'::text]))`

Index :

- `scheduled_job_due_idx` : `CREATE INDEX scheduled_job_due_idx ON core.outbox_scheduled_job USING btree (name, run_at) WHERE (state = ANY (ARRAY['CREATED'::text, 'ACTIVE'::text]))`
- `scheduled_job_singleton` : `CREATE UNIQUE INDEX scheduled_job_singleton ON core.outbox_scheduled_job USING btree (name, singleton_key) WHERE ((singleton_key IS NOT NULL) AND (state = ANY (ARRAY['CREATED'::text, 'ACTIVE'::text])))`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (state = 'CREATED'::text) AND (attempts = 0) AND (event_id IS NULL))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL) AND (state = 'CREATED'::text) AND (attempts = 0))`
- `worker_select_monitor` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bus_monitor'::text))`
- `worker_select_own_queue` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (name = app.worker_name()))`
- `worker_update_own_queue` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (name = app.worker_name()))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (name = app.worker_name()))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.outbox_scheduled_job FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_debt_balance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `charge_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `origin_type` | `text` | oui | `'POST_TRIP_CHARGE'::text` |
| `opened_reason` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `due_host_minor` | `bigint` | oui | — |
| `due_insurer_minor` | `bigint` | oui | — |
| `due_tax_third_party_minor` | `bigint` | oui | — |
| `due_platform_minor` | `bigint` | oui | — |
| `paid_host_minor` | `bigint` | oui | `0` |
| `paid_insurer_minor` | `bigint` | oui | `0` |
| `paid_tax_third_party_minor` | `bigint` | oui | `0` |
| `paid_platform_minor` | `bigint` | oui | `0` |
| `collection_seq` | `integer` | oui | `0` |
| `rule_version` | `text` | oui | `'E7R4-US056'::text` |
| `status` | `text` | oui | `'OPEN'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `debt_balance_amount_positive` : `CHECK (amount_minor > 0)`
- `debt_balance_charge_fk` : `FOREIGN KEY (charge_id) REFERENCES core.payment_post_trip_charge(id)`
- `debt_balance_charge_unique` : `UNIQUE (charge_id)`
- `debt_balance_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `debt_balance_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `debt_balance_due_sum` : `CHECK ((due_host_minor + due_insurer_minor + due_tax_third_party_minor + due_platform_minor) = amount_minor)`
- `debt_balance_origin_valid` : `CHECK (origin_type = 'POST_TRIP_CHARGE'::text)`
- `debt_balance_paid_bounds` : `CHECK (paid_host_minor >= 0 AND paid_host_minor <= due_host_minor AND paid_insurer_minor >= 0 AND paid_insurer_minor <= due_insurer_minor AND paid_tax_third_party_minor >= 0 AND paid_tax_third_party_minor <= due_tax_third_party_minor AND paid_platform_minor >= 0 AND paid_platform_minor <= due_platform_minor)`
- `debt_balance_reason_format` : `CHECK (opened_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `debt_balance_rule_valid` : `CHECK (rule_version = 'E7R4-US056'::text)`
- `debt_balance_seq_nonneg` : `CHECK (collection_seq >= 0)`
- `debt_balance_status_shape` : `CHECK ((status = 'PAID'::text) = ((paid_host_minor + paid_insurer_minor + paid_tax_third_party_minor + paid_platform_minor) = amount_minor) AND (status = 'OPEN'::text) = ((paid_host_minor + paid_insurer_minor + paid_tax_third_party_minor + paid_platform_minor) = 0))`
- `debt_balance_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_PAID'::text, 'PAID'::text]))`
- `debt_balance_trip_fk` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `debt_balance_user_fk` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `payment_debt_balance_due_host_minor_check` : `CHECK (due_host_minor >= 0)`
- `payment_debt_balance_due_insurer_minor_check` : `CHECK (due_insurer_minor >= 0)`
- `payment_debt_balance_due_platform_minor_check` : `CHECK (due_platform_minor >= 0)`
- `payment_debt_balance_due_tax_third_party_minor_check` : `CHECK (due_tax_third_party_minor >= 0)`
- `payment_debt_balance_pkey` : `PRIMARY KEY (id)`

Index :

- `debt_balance_user_idx` : `CREATE INDEX debt_balance_user_idx ON core.payment_debt_balance USING btree (user_id) WHERE (status <> 'PAID'::text)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'OPEN'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_debt_guard` : `CREATE TRIGGER mit_debt_guard BEFORE UPDATE ON core.payment_debt_balance FOR EACH ROW EXECUTE FUNCTION core.payment_debt_balance_guard()`
- `mit_debt_no_delete` : `CREATE TRIGGER mit_debt_no_delete BEFORE DELETE ON core.payment_debt_balance FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_debt_no_truncate` : `CREATE TRIGGER mit_debt_no_truncate BEFORE TRUNCATE ON core.payment_debt_balance FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_debt_collection`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `debt_id` | `uuid` | oui | — |
| `seq` | `integer` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `leg_host_minor` | `bigint` | oui | — |
| `leg_insurer_minor` | `bigint` | oui | — |
| `leg_tax_third_party_minor` | `bigint` | oui | — |
| `leg_platform_minor` | `bigint` | oui | — |
| `rule_version` | `text` | oui | — |
| `idem_plain` | `text` | oui | — |
| `idem_sent` | `text` | oui | — |
| `operation_id` | `uuid` | non | — |
| `status` | `text` | oui | `'PLANNED'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `settled_at` | `timestamp with time zone` | non | — |

Contraintes :

- `debt_collection_amount_positive` : `CHECK (amount_minor > 0)`
- `debt_collection_debt_fk` : `FOREIGN KEY (debt_id) REFERENCES core.payment_debt_balance(id)`
- `debt_collection_idem_sent_format` : `CHECK (idem_sent ~ '^[0-9a-f]{64}$'::text)`
- `debt_collection_idem_unique` : `UNIQUE (idem_plain)`
- `debt_collection_legs_sum` : `CHECK ((leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor) = amount_minor)`
- `debt_collection_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `debt_collection_operation_unique` : `UNIQUE (operation_id)`
- `debt_collection_rule_valid` : `CHECK (rule_version = 'E7R4-US056'::text)`
- `debt_collection_seq_positive` : `CHECK (seq >= 1)`
- `debt_collection_seq_unique` : `UNIQUE (debt_id, seq)`
- `debt_collection_settled_shape` : `CHECK ((status = 'PLANNED'::text) = (settled_at IS NULL))`
- `debt_collection_status_valid` : `CHECK (status = ANY (ARRAY['PLANNED'::text, 'COLLECTED'::text, 'FAILED'::text]))`
- `payment_debt_collection_leg_host_minor_check` : `CHECK (leg_host_minor >= 0)`
- `payment_debt_collection_leg_insurer_minor_check` : `CHECK (leg_insurer_minor >= 0)`
- `payment_debt_collection_leg_platform_minor_check` : `CHECK (leg_platform_minor >= 0)`
- `payment_debt_collection_leg_tax_third_party_minor_check` : `CHECK (leg_tax_third_party_minor >= 0)`
- `payment_debt_collection_pkey` : `PRIMARY KEY (id)`

Index :

- `debt_collection_one_planned_idx` : `CREATE UNIQUE INDEX debt_collection_one_planned_idx ON core.payment_debt_collection USING btree (debt_id) WHERE (status = 'PLANNED'::text)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'PLANNED'::text) AND (operation_id IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_collection_guard` : `CREATE TRIGGER mit_collection_guard BEFORE UPDATE ON core.payment_debt_collection FOR EACH ROW EXECUTE FUNCTION core.payment_debt_collection_guard()`
- `mit_collection_no_delete` : `CREATE TRIGGER mit_collection_no_delete BEFORE DELETE ON core.payment_debt_collection FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_collection_no_truncate` : `CREATE TRIGGER mit_collection_no_truncate BEFORE TRUNCATE ON core.payment_debt_collection FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_deposit_hold`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `hold_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `provider` | `text` | non | — |
| `mechanism` | `text` | oui | — |
| `triggers` | `text[]` | oui | — |
| `params_snapshot` | `jsonb` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `h_required_hours` | `integer` | non | — |
| `v_hours_snapshot` | `integer` | non | — |
| `auth_at` | `timestamp with time zone` | non | — |
| `auth_expiry_at` | `timestamp with time zone` | non | — |
| `auth_provider_reference` | `text` | non | — |
| `release_at` | `timestamp with time zone` | non | — |
| `decision_at` | `timestamp with time zone` | non | — |
| `reauth_due_at` | `timestamp with time zone` | non | — |
| `reauth_seq` | `integer` | oui | `0` |
| `status` | `text` | non | — |
| `decided_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |
| `captured_minor` | `bigint` | non | — |
| `released_minor` | `bigint` | non | — |
| `decision_executed_at` | `timestamp with time zone` | non | — |

Contraintes :

- `deposit_hold_amount_nonnegative` : `CHECK (amount_minor >= 0)`
- `deposit_hold_authorized_shape` : `CHECK (status IS DISTINCT FROM 'AUTHORIZED'::text OR auth_provider_reference IS NOT NULL AND (mechanism = 'CHARGE_THEN_REFUND'::text OR auth_expiry_at IS NOT NULL))`
- `deposit_hold_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `deposit_hold_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `deposit_hold_decision_window` : `CHECK (decision_at IS NULL OR decision_at <= release_at AND decision_at >= auth_at AND (auth_expiry_at IS NULL OR decision_at <= auth_expiry_at OR mechanism = 'REAUTH'::text AND reauth_due_at IS NOT NULL))`
- `deposit_hold_final_shape` : `CHECK (COALESCE(status = ANY (ARRAY['PARTIALLY_CAPTURED'::text, 'VOIDED'::text, 'REFUNDED'::text, 'EXPIRED'::text]), false) = (decision_executed_at IS NOT NULL) AND (decision_executed_at IS NULL) = (captured_minor IS NULL) AND (decision_executed_at IS NULL) = (released_minor IS NULL) AND (decision_executed_at IS NULL OR captured_minor >= 0 AND released_minor >= 0 AND (captured_minor + released_minor) = amount_minor AND (status = 'PARTIALLY_CAPTURED'::text) = (captured_minor > 0)))`
- `deposit_hold_h_required_positive` : `CHECK (h_required_hours > 0)`
- `deposit_hold_hold_fk` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `deposit_hold_hold_unique` : `UNIQUE (hold_id)`
- `deposit_hold_mechanism_valid` : `CHECK (mechanism = ANY (ARRAY['NOT_REQUIRED'::text, 'PREAUTH_SINGLE'::text, 'REAUTH'::text, 'CHARGE_THEN_REFUND'::text]))`
- `deposit_hold_not_required_empty` : `CHECK (mechanism <> 'NOT_REQUIRED'::text OR status IS NULL AND h_required_hours IS NULL AND v_hours_snapshot IS NULL AND auth_at IS NULL AND auth_expiry_at IS NULL AND auth_provider_reference IS NULL AND release_at IS NULL AND decision_at IS NULL AND reauth_due_at IS NULL AND reauth_seq = 0)`
- `deposit_hold_not_required_shape` : `CHECK ((mechanism = 'NOT_REQUIRED'::text) = (cardinality(triggers) = 0) AND (mechanism = 'NOT_REQUIRED'::text) = (amount_minor = 0))`
- `deposit_hold_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `deposit_hold_provider_reference_format` : `CHECK (auth_provider_reference ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `deposit_hold_reauth_seq_nonnegative` : `CHECK (reauth_seq >= 0)`
- `deposit_hold_reauth_shape` : `CHECK (reauth_due_at IS NULL OR mechanism = 'REAUTH'::text AND (status = ANY (ARRAY['PLANNED'::text, 'AUTHORIZED'::text])) AND (auth_expiry_at IS NULL OR reauth_due_at < auth_expiry_at))`
- `deposit_hold_required_shape` : `CHECK (mechanism = 'NOT_REQUIRED'::text OR status IS NOT NULL AND h_required_hours IS NOT NULL AND v_hours_snapshot IS NOT NULL AND auth_at IS NOT NULL AND release_at IS NOT NULL AND decision_at IS NOT NULL)`
- `deposit_hold_snapshot_object` : `CHECK (jsonb_typeof(params_snapshot) = 'object'::text)`
- `deposit_hold_status_valid` : `CHECK (status = ANY (ARRAY['PLANNED'::text, 'AUTHORIZED'::text, 'PARTIALLY_CAPTURED'::text, 'VOIDED'::text, 'REFUNDED'::text, 'EXPIRED'::text]))`
- `deposit_hold_triggers_valid` : `CHECK (triggers <@ ARRAY['AGE'::text, 'CLASS'::text, 'COUNTRY'::text, 'RISK'::text] AND array_position(triggers, NULL::text) IS NULL)`
- `deposit_hold_v_nonnegative` : `CHECK (v_hours_snapshot >= 0)`
- `payment_deposit_hold_pkey` : `PRIMARY KEY (id)`

Index :

- `deposit_hold_decision_due_idx` : `CREATE INDEX deposit_hold_decision_due_idx ON core.payment_deposit_hold USING btree (decision_at) WHERE (status = 'AUTHORIZED'::text)`
- `deposit_hold_reauth_due_idx` : `CREATE INDEX deposit_hold_reauth_due_idx ON core.payment_deposit_hold USING btree (reauth_due_at) WHERE (reauth_due_at IS NOT NULL)`

Politiques RLS :

- `cmd_hold_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND ((status IS NULL) OR (status = 'PLANNED'::text)) AND (reauth_seq = 0) AND (auth_expiry_at IS NULL) AND (auth_provider_reference IS NULL))`
- `cmd_hold_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `deposit_hold_guard` : `CREATE TRIGGER deposit_hold_guard BEFORE UPDATE ON core.payment_deposit_hold FOR EACH ROW EXECUTE FUNCTION core.payment_deposit_hold_guard()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.payment_deposit_hold FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.payment_deposit_hold FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_deposit_hold FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_mit_consent`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `hold_id` | `uuid` | non | — |
| `trip_id` | `uuid` | non | — |
| `instrument_id` | `uuid` | non | — |
| `scopes` | `text[]` | oui | — |
| `consent_key` | `text` | oui | — |
| `catalog_version` | `integer` | oui | — |
| `locale` | `text` | oui | — |
| `accepted_at` | `timestamp with time zone` | oui | `platform.now()` |
| `bound_at` | `timestamp with time zone` | non | — |
| `network_tx_reference` | `text` | non | — |
| `transaction_link_id` | `text` | non | — |

Contraintes :

- `mit_consent_bound_shape` : `CHECK ((instrument_id IS NULL) = (bound_at IS NULL))`
- `mit_consent_catalog_version_positive` : `CHECK (catalog_version >= 1)`
- `mit_consent_hold_fk` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `mit_consent_hold_unique` : `UNIQUE (hold_id)`
- `mit_consent_instrument_fk` : `FOREIGN KEY (instrument_id) REFERENCES core.payment_payment_instrument(id)`
- `mit_consent_key_format` : `CHECK (consent_key ~ '^[a-z][A-Za-z0-9.]{2,80}$'::text)`
- `mit_consent_link_format` : `CHECK (transaction_link_id IS NULL OR transaction_link_id ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `mit_consent_locale_format` : `CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)`
- `mit_consent_network_ref_format` : `CHECK (network_tx_reference IS NULL OR network_tx_reference ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `mit_consent_scopes_valid` : `CHECK (cardinality(scopes) > 0 AND scopes <@ ARRAY['DELAYED_CHARGES'::text, 'NO_SHOW'::text, 'DAMAGE_SEPARATE'::text, 'REAUTHORIZATION'::text])`
- `mit_consent_subject` : `CHECK (hold_id IS NOT NULL OR trip_id IS NOT NULL)`
- `mit_consent_trip_fk` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `mit_consent_trip_unique` : `UNIQUE (trip_id)`
- `mit_consent_user_fk` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `payment_mit_consent_pkey` : `PRIMARY KEY (id)`

Politiques RLS :

- `cmd_money_guest_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (instrument_id IS NULL) AND (trip_id IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_consent_guard` : `CREATE TRIGGER mit_consent_guard BEFORE UPDATE ON core.payment_mit_consent FOR EACH ROW EXECUTE FUNCTION core.payment_mit_consent_guard()`
- `mit_consent_no_delete` : `CREATE TRIGGER mit_consent_no_delete BEFORE DELETE ON core.payment_mit_consent FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_consent_no_truncate` : `CREATE TRIGGER mit_consent_no_truncate BEFORE TRUNCATE ON core.payment_mit_consent FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_mit_consent_reminder`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `consent_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `catalog_version` | `integer` | oui | — |
| `locale` | `text` | oui | — |
| `acknowledged_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `mit_reminder_catalog_version_positive` : `CHECK (catalog_version >= 1)`
- `mit_reminder_consent_fk` : `FOREIGN KEY (consent_id) REFERENCES core.payment_mit_consent(id)`
- `mit_reminder_locale_format` : `CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)`
- `mit_reminder_trip_fk` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `mit_reminder_user_fk` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `payment_mit_consent_reminder_pkey` : `PRIMARY KEY (trip_id)`

Politiques RLS :

- `cmd_money_guest_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `(app.actor_kind() = 'GUEST'::text)`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_reminder_append_only` : `CREATE TRIGGER mit_reminder_append_only BEFORE DELETE OR UPDATE ON core.payment_mit_consent_reminder FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_reminder_no_truncate` : `CREATE TRIGGER mit_reminder_no_truncate BEFORE TRUNCATE ON core.payment_mit_consent_reminder FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_mit_network_rule`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `country_code` | `text` | oui | — |
| `network` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `version` | `integer` | oui | — |
| `notice_hours` | `integer` | non | — |
| `deadline_days` | `integer` | non | — |
| `deadline_from` | `text` | oui | — |
| `retry_offsets_days` | `integer[]` | oui | — |
| `source_ref` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `mit_rule_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `mit_rule_deadline_from_valid` : `CHECK (deadline_from = ANY (ARRAY['RETURN'::text, 'NOTICE'::text]))`
- `mit_rule_deadline_valid` : `CHECK (deadline_days IS NULL OR deadline_days >= 1 AND deadline_days <= 730)`
- `mit_rule_network_valid` : `CHECK (network = ANY (ARRAY['VISA'::text, 'MASTERCARD'::text, 'AMEX'::text]))`
- `mit_rule_notice_valid` : `CHECK (notice_hours IS NULL OR notice_hours >= 0 AND notice_hours <= 8760)`
- `mit_rule_offsets_valid` : `CHECK (cardinality(retry_offsets_days) >= 1 AND cardinality(retry_offsets_days) <= 10 AND retry_offsets_days[1] = 0 AND (0 <= ALL (retry_offsets_days)))`
- `mit_rule_reason_valid` : `CHECK (reason = ANY (ARRAY['DELAYED_CHARGES'::text, 'NO_SHOW'::text, 'DAMAGE_SEPARATE'::text]))`
- `mit_rule_source_present` : `CHECK (source_ref <> ''::text)`
- `mit_rule_version_positive` : `CHECK (version >= 1)`
- `payment_mit_network_rule_pkey` : `PRIMARY KEY (country_code, network, reason, version)`

Politiques RLS :

- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_rule_append_only` : `CREATE TRIGGER mit_rule_append_only BEFORE DELETE OR UPDATE ON core.payment_mit_network_rule FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_rule_no_truncate` : `CREATE TRIGGER mit_rule_no_truncate BEFORE TRUNCATE ON core.payment_mit_network_rule FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_payment_command`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `operation_kind` | `text` | oui | — |
| `idem_plain` | `text` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `hold_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `next_attempt_at` | `timestamp with time zone` | oui | `platform.now()` |
| `attempts` | `integer` | oui | `0` |
| `last_error` | `text` | non | — |
| `partition_key` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `payment_command_attempts_nonnegative` : `CHECK (attempts >= 0)`
- `payment_command_cancel_key` : `CHECK (operation_kind <> 'CANCEL_ORDER'::text OR idem_plain = (((('hold:'::text \|\| hold_id::text) \|\| ':CANCEL:'::text) \|\| operation_id::text) \|\| ':a1'::text))`
- `payment_command_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_command_hold_fk` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `payment_command_idem_unique` : `UNIQUE (idem_plain)`
- `payment_command_kind_valid` : `CHECK (operation_kind = ANY (ARRAY['CANCEL_ORDER'::text, 'VOID'::text]))`
- `payment_command_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `payment_command_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'IN_FLIGHT'::text, 'DONE'::text, 'UNKNOWN'::text, 'ABANDONED'::text]))`
- `payment_command_void_key` : `CHECK (operation_kind <> 'VOID'::text OR idem_plain = (((('hold:'::text \|\| hold_id::text) \|\| ':VOID:'::text) \|\| operation_id::text) \|\| ':a1'::text))`
- `payment_payment_command_pkey` : `PRIMARY KEY (id)`

Index :

- `payment_command_due_idx` : `CREATE INDEX payment_command_due_idx ON core.payment_payment_command USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'UNKNOWN'::text]))`
- `payment_command_hold_idx` : `CREATE INDEX payment_command_hold_idx ON core.payment_payment_command USING btree (hold_id)`

Politiques RLS :

- `cmd_hold_command_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (operation_kind = 'CANCEL_ORDER'::text) AND (status = 'PENDING'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_command.hold_id) AND (h.guest_user_id = app.actor_id())))) AND (EXISTS ( SELECT 1 FROM core.payment_payment_operation o WHERE ((o.id = payment_payment_command.operation_id) AND (o.hold_id = payment_payment_command.hold_id)))))`
- `cmd_hold_command_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_request_command_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((operation_kind = 'VOID'::text) AND (status = 'PENDING'::text) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_command.operation_id) AND (o.hold_id = payment_payment_command.hold_id) AND (o.kind = 'VOID'::text) AND (h.kind = 'REQUEST'::text) AND (((app.actor_kind() = 'HOST'::text) AND (h.org_id = app.org_id())) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['hold_expiry'::text, 'booking_conversion'::text]))))))))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (operation_kind = 'CANCEL_ORDER'::text) AND (status = 'PENDING'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'ops_monitor'::text])))`
- `worker_update_command` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.payment_payment_command FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_payment_command FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_payment_instrument`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `psp_account_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `token_ref` | `text` | oui | — |
| `network` | `text` | oui | — |
| `funding` | `text` | oui | — |
| `last4` | `text` | oui | — |
| `exp_month` | `smallint` | oui | — |
| `exp_year` | `smallint` | oui | — |
| `status` | `text` | oui | `'ACTIVE'::text` |
| `replaced_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payment_instrument_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `payment_instrument_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_instrument_exp_month_valid` : `CHECK (exp_month >= 1 AND exp_month <= 12)`
- `payment_instrument_exp_year_valid` : `CHECK (exp_year >= 2000 AND exp_year <= 2200)`
- `payment_instrument_funding_valid` : `CHECK (funding = ANY (ARRAY['CREDIT'::text, 'DEBIT'::text, 'PREPAID'::text]))`
- `payment_instrument_last4_format` : `CHECK (last4 ~ '^[0-9]{4}$'::text)`
- `payment_instrument_network_valid` : `CHECK (network = ANY (ARRAY['VISA'::text, 'MASTERCARD'::text, 'AMEX'::text]))`
- `payment_instrument_replaced_shape` : `CHECK ((status = 'ACTIVE'::text) = (replaced_at IS NULL))`
- `payment_instrument_status_valid` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'REPLACED'::text, 'REVOKED'::text]))`
- `payment_instrument_token_format` : `CHECK (token_ref ~ '^[A-Za-z0-9_.:-]{8,128}$'::text)`
- `payment_instrument_token_no_pan` : `CHECK (NOT core.payment_text_has_pan(token_ref))`
- `payment_instrument_token_unique` : `UNIQUE (psp_account_id, token_ref)`
- `payment_instrument_user_fk` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `payment_payment_instrument_pkey` : `PRIMARY KEY (id)`

Index :

- `payment_instrument_one_active_idx` : `CREATE UNIQUE INDEX payment_instrument_one_active_idx ON core.payment_payment_instrument USING btree (user_id, psp_account_id) WHERE (status = 'ACTIVE'::text)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'ACTIVE'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_instrument_guard` : `CREATE TRIGGER mit_instrument_guard BEFORE UPDATE ON core.payment_payment_instrument FOR EACH ROW EXECUTE FUNCTION core.payment_instrument_guard()`
- `mit_instrument_no_delete` : `CREATE TRIGGER mit_instrument_no_delete BEFORE DELETE ON core.payment_payment_instrument FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_instrument_no_truncate` : `CREATE TRIGGER mit_instrument_no_truncate BEFORE TRUNCATE ON core.payment_payment_instrument FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_payment_operation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `hold_id` | `uuid` | non | — |
| `trip_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `provider` | `text` | oui | — |
| `method` | `text` | non | — |
| `kind` | `text` | oui | — |
| `purpose` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `currency` | `text` | oui | — |
| `attempt_no` | `integer` | oui | — |
| `status` | `text` | oui | — |
| `idem_plain` | `text` | oui | — |
| `idem_sent` | `text` | oui | — |
| `provider_reference` | `text` | non | — |
| `proof_type` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |
| `psp_account_id` | `uuid` | oui | — |
| `settlement_id` | `uuid` | non | — |
| `settlement_version` | `integer` | non | — |

Contraintes :

- `payment_operation_amount_positive` : `CHECK (amount_minor > 0)`
- `payment_operation_attempt_positive` : `CHECK (attempt_no >= 1)`
- `payment_operation_auth_capture_purpose` : `CHECK ((kind <> ALL (ARRAY['AUTH'::text, 'CAPTURE'::text])) OR (purpose = ANY (ARRAY['RENT'::text, 'RENT_SHORTFALL'::text])))`
- `payment_operation_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_operation_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `payment_operation_deposit_kind` : `CHECK ((kind = ANY (ARRAY['DEPOSIT_AUTH'::text, 'DEPOSIT_CAPTURE'::text, 'DEPOSIT_VOID'::text])) = (purpose = 'DEPOSIT'::text))`
- `payment_operation_has_subject` : `CHECK (trip_id IS NOT NULL OR hold_id IS NOT NULL)`
- `payment_operation_idem_plain_unique` : `UNIQUE (idem_plain)`
- `payment_operation_kind_valid` : `CHECK (kind = ANY (ARRAY['AUTH'::text, 'CAPTURE'::text, 'VOID'::text, 'REFUND'::text, 'MIT_CHARGE'::text, 'DEBT_COLLECTION'::text, 'CREDIT_REDEMPTION'::text, 'CREDIT_REISSUE'::text, 'CHARGEBACK'::text, 'CHARGEBACK_REVERSAL'::text, 'DEPOSIT_AUTH'::text, 'DEPOSIT_CAPTURE'::text, 'DEPOSIT_VOID'::text, 'LEG_REALLOCATION'::text, 'LEG_RELEASE'::text]))`
- `payment_operation_legs_check` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `payment_operation_mit_purpose` : `CHECK (kind <> 'MIT_CHARGE'::text OR (purpose = ANY (ARRAY['RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text, 'INCIDENTAL'::text, 'DAMAGE'::text, 'OTHER_DEBT'::text])))`
- `payment_operation_proof_type_valid` : `CHECK (proof_type = ANY (ARRAY['WEBHOOK_SIGNED'::text, 'POLL'::text]))`
- `payment_operation_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `payment_operation_psp_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `payment_operation_purpose_valid` : `CHECK (purpose = ANY (ARRAY['RENT'::text, 'RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text, 'DEPOSIT'::text, 'INCIDENTAL'::text, 'DAMAGE'::text, 'OTHER_DEBT'::text]))`
- `payment_operation_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, settlement_version) REFERENCES core.settlement_settlement(id, trip_id, version)`
- `payment_operation_settlement_kind` : `CHECK (settlement_id IS NULL OR trip_id IS NOT NULL AND (kind = ANY (ARRAY['REFUND'::text, 'LEG_REALLOCATION'::text, 'LEG_RELEASE'::text])) AND (purpose = ANY (ARRAY['RENT'::text, 'RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text])))`
- `payment_operation_settlement_shape` : `CHECK ((settlement_id IS NULL) = (settlement_version IS NULL))`
- `payment_operation_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'SUBMITTED'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'UNKNOWN'::text]))`
- `payment_payment_operation_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `payment_payment_operation_pkey` : `PRIMARY KEY (id)`
- `payment_payment_operation_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Index :

- `payment_operation_hold_idx` : `CREATE INDEX payment_operation_hold_idx ON core.payment_payment_operation USING btree (hold_id) WHERE (hold_id IS NOT NULL)`
- `payment_operation_provider_reference_unique` : `CREATE UNIQUE INDEX payment_operation_provider_reference_unique ON core.payment_payment_operation USING btree (psp_account_id, provider_reference) WHERE (provider_reference IS NOT NULL)`
- `payment_operation_settlement_idx` : `CREATE INDEX payment_operation_settlement_idx ON core.payment_payment_operation USING btree (settlement_id) WHERE (settlement_id IS NOT NULL)`
- `payment_operation_trip_idx` : `CREATE INDEX payment_operation_trip_idx ON core.payment_payment_operation USING btree (trip_id) WHERE (trip_id IS NOT NULL)`

Politiques RLS :

- `cmd_hold_pay_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (purpose = 'RENT'::text) AND (kind = 'CAPTURE'::text) AND (status = 'PENDING'::text) AND (trip_id IS NULL) AND (psp_account_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id()) AND (h.status = 'PAYMENT_IN_FLIGHT'::text)))))`
- `cmd_hold_pay_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'GUEST'::text) AND (purpose = 'RENT'::text) AND (status = 'PENDING'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id())))))` WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (status = 'SUBMITTED'::text))`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_request_auth_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (purpose = 'RENT'::text) AND (kind = 'AUTH'::text) AND (status = 'PENDING'::text) AND (trip_id IS NULL) AND (psp_account_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id()) AND (h.kind = 'REQUEST'::text) AND (h.status = 'PAYMENT_IN_FLIGHT'::text)))))`
- `cmd_hold_request_pay_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((purpose = 'RENT'::text) AND (status = 'PENDING'::text) AND (trip_id IS NULL) AND (psp_account_id IS NOT NULL) AND (((kind = 'CAPTURE'::text) AND (app.actor_kind() = 'HOST'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.kind = 'REQUEST'::text) AND (h.org_id = app.org_id()) AND (h.status = 'PAYMENT_IN_FLIGHT'::text) AND (h.request_respond_by IS NOT NULL))))) OR ((kind = 'VOID'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.kind = 'REQUEST'::text) AND (((app.actor_kind() = 'HOST'::text) AND (h.org_id = app.org_id())) OR ((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['hold_expiry'::text, 'booking_conversion'::text]))))))))))`
- `cmd_hold_request_pay_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'HOST'::text) AND (purpose = 'RENT'::text) AND (kind = 'CAPTURE'::text) AND (status = 'PENDING'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.kind = 'REQUEST'::text) AND (h.org_id = app.org_id())))))` WITH CHECK `((app.actor_kind() = 'HOST'::text) AND (status = 'SUBMITTED'::text))`
- `cmd_money_conversion_attach` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (trip_id IS NULL) AND (hold_id IS NOT NULL) AND (kind = 'CAPTURE'::text) AND (purpose = 'RENT'::text) AND (status = 'SUCCEEDED'::text) AND (proof_type IS NOT NULL))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (kind = 'CAPTURE'::text) AND (purpose = 'RENT'::text) AND (status = 'SUCCEEDED'::text) AND (proof_type IS NOT NULL) AND (EXISTS ( SELECT 1 FROM core.booking_payment_disposition d WHERE ((d.operation_id = payment_payment_operation.id) AND (d.hold_id = payment_payment_operation.hold_id) AND (d.disposition = 'CONVERSION'::text) AND (d.trip_id = payment_payment_operation.trip_id)))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'PENDING'::text) AND (psp_account_id IS NOT NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])) AND (psp_account_id IS NOT NULL))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (psp_account_id IS NOT NULL))`
- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `operation_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND ((EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id())))) OR (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE (t.id = payment_payment_operation.trip_id)))))`
- `operation_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR ((trip_id IS NOT NULL) AND app.staff_case_covers('TRIP'::text, trip_id))))`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'webhook_ingest'::text, 'booking_oracle'::text, 'ops_monitor'::text])))`
- `worker_select_payment_command` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `worker_update_status` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'webhook_ingest'::text])) AND (status <> ALL (ARRAY['SUCCEEDED'::text, 'FAILED'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'webhook_ingest'::text])) AND (status <> ALL (ARRAY['SUCCEEDED'::text, 'FAILED'::text])) AND (proof_type IS NULL))`

Déclencheurs :

- `operation_trip_attach_guard` : `CREATE TRIGGER operation_trip_attach_guard BEFORE UPDATE OF trip_id ON core.payment_payment_operation FOR EACH ROW WHEN (old.trip_id IS DISTINCT FROM new.trip_id) EXECUTE FUNCTION core.payment_guard_operation_trip_attach()`
- `payment_operation_chargeback_freeze` : `CREATE TRIGGER payment_operation_chargeback_freeze AFTER INSERT OR UPDATE OF status, trip_id ON core.payment_payment_operation FOR EACH ROW WHEN (new.kind = 'CHARGEBACK'::text) EXECUTE FUNCTION core.settlement_freeze_host_on_chargeback()`
- `payment_operation_legs_check` : `CREATE CONSTRAINT TRIGGER payment_operation_legs_check AFTER INSERT ON core.payment_payment_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.payment_assert_operation_legs()`
- `payment_operation_mit_guard` : `CREATE TRIGGER payment_operation_mit_guard BEFORE INSERT ON core.payment_payment_operation FOR EACH ROW WHEN (new.kind = ANY (ARRAY['MIT_CHARGE'::text, 'DEBT_COLLECTION'::text])) EXECUTE FUNCTION core.payment_operation_mit_guard()`
- `refund_instance_gate` : `CREATE TRIGGER refund_instance_gate BEFORE UPDATE OF status ON core.payment_payment_operation FOR EACH ROW EXECUTE FUNCTION core.payment_refund_instance_gate()`
- `refund_instance_sync` : `CREATE TRIGGER refund_instance_sync AFTER UPDATE OF status ON core.payment_payment_operation FOR EACH ROW WHEN (new.kind = 'REFUND'::text) EXECUTE FUNCTION core.payment_refund_instance_sync()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_payment_operation FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_payment_operation_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `status` | `text` | oui | — |
| `source` | `text` | oui | — |
| `outcome` | `text` | oui | — |
| `raw_ref` | `uuid` | non | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payment_operation_event_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `payment_operation_event_outcome_valid` : `CHECK (outcome = ANY (ARRAY['APPLIED'::text, 'DUPLICATE'::text, 'STALE'::text, 'CONFLICT'::text, 'UNPROVEN'::text, 'MISMATCH'::text]))`
- `payment_operation_event_raw_ref_fk` : `FOREIGN KEY (raw_ref) REFERENCES core.payment_webhook_inbox(id)`
- `payment_operation_event_source_valid` : `CHECK (source = ANY (ARRAY['API_RESPONSE'::text, 'WEBHOOK'::text, 'POLL'::text, 'MANUAL_OPS'::text]))`
- `payment_operation_event_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'SUBMITTED'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'UNKNOWN'::text]))`
- `payment_payment_operation_event_pkey` : `PRIMARY KEY (id)`

Index :

- `payment_operation_event_operation_idx` : `CREATE INDEX payment_operation_event_operation_idx ON core.payment_payment_operation_event USING btree (operation_id, at)`

Politiques RLS :

- `cmd_hold_opevent_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (source = 'API_RESPONSE'::text) AND (raw_ref IS NULL) AND (status = 'SUBMITTED'::text) AND (outcome = 'APPLIED'::text) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_event.operation_id) AND (o.purpose = 'RENT'::text) AND (h.guest_user_id = app.actor_id())))))`
- `cmd_hold_request_opevent_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'HOST'::text) AND (source = 'API_RESPONSE'::text) AND (raw_ref IS NULL) AND (status = 'SUBMITTED'::text) AND (outcome = 'APPLIED'::text) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_event.operation_id) AND (o.kind = 'CAPTURE'::text) AND (h.kind = 'REQUEST'::text) AND (h.org_id = app.org_id())))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `worker_select_disposition` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['disposition_sweeper'::text, 'booking_oracle'::text])))`

### `core.payment_payment_operation_leg`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; integrity_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `leg` | `text` | oui | — |
| `org_id` | `uuid` | non | — |
| `trip_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `beneficiary_ref` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payment_operation_leg_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_operation_leg_name` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `payment_operation_leg_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `payment_operation_leg_pkey` : `PRIMARY KEY (operation_id, leg)`
- `payment_operation_legs_check` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`

Politiques RLS :

- `cmd_hold_leg_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (trip_id IS NULL) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_leg.operation_id) AND (o.status = 'PENDING'::text) AND (o.purpose = 'RENT'::text) AND (h.guest_user_id = app.actor_id())))))`
- `cmd_hold_leg_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'GUEST'::text) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_leg.operation_id) AND (h.guest_user_id = app.actor_id())))))`
- `cmd_hold_request_leg_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'HOST'::text) AND (trip_id IS NULL) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_leg.operation_id) AND (o.kind = 'CAPTURE'::text) AND (o.status = 'PENDING'::text) AND (o.purpose = 'RENT'::text) AND (h.kind = 'REQUEST'::text) AND (h.org_id = app.org_id())))))`
- `cmd_money_conversion_attach` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (trip_id IS NULL))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_payment_disposition d ON (((d.operation_id = o.id) AND (d.disposition = 'CONVERSION'::text)))) WHERE ((o.id = payment_payment_operation_leg.operation_id) AND (o.trip_id = payment_payment_operation_leg.trip_id) AND (d.trip_id = payment_payment_operation_leg.trip_id)))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `leg_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (leg = 'HOST'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `leg_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR ((trip_id IS NOT NULL) AND app.staff_case_covers('TRIP'::text, trip_id))))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `worker_select_conversion` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`

Déclencheurs :

- `operation_leg_trip_attach_guard` : `CREATE TRIGGER operation_leg_trip_attach_guard BEFORE UPDATE OF trip_id ON core.payment_payment_operation_leg FOR EACH ROW WHEN (old.trip_id IS DISTINCT FROM new.trip_id) EXECUTE FUNCTION core.payment_guard_leg_trip_attach()`
- `payment_operation_leg_payout_item_guard` : `CREATE TRIGGER payment_operation_leg_payout_item_guard AFTER INSERT ON core.payment_payment_operation_leg REFERENCING NEW TABLE AS new_legs FOR EACH STATEMENT EXECUTE FUNCTION core.payout_release_item_guard()`
- `payment_operation_leg_release_guard` : `CREATE TRIGGER payment_operation_leg_release_guard AFTER INSERT ON core.payment_payment_operation_leg REFERENCING NEW TABLE AS new_legs FOR EACH STATEMENT EXECUTE FUNCTION core.payment_operation_leg_release_guard()`
- `payment_operation_legs_check` : `CREATE CONSTRAINT TRIGGER payment_operation_legs_check AFTER INSERT ON core.payment_payment_operation_leg DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.payment_assert_operation_legs()`

### `core.payment_post_trip_charge`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `purpose` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `origin_type` | `text` | oui | — |
| `origin_id` | `uuid` | oui | — |
| `settlement_version` | `integer` | non | — |
| `tender_operation_id` | `uuid` | oui | — |
| `psp_account_id` | `uuid` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `leg_host_minor` | `bigint` | oui | — |
| `leg_insurer_minor` | `bigint` | oui | — |
| `leg_tax_third_party_minor` | `bigint` | oui | — |
| `leg_platform_minor` | `bigint` | oui | — |
| `notified_at` | `timestamp with time zone` | oui | `platform.now()` |
| `guest_agreed_at` | `timestamp with time zone` | non | — |
| `status` | `text` | oui | `'NOTIFIED'::text` |
| `next_check_at` | `timestamp with time zone` | oui | `platform.now()` |
| `network` | `text` | non | — |
| `first_attempt_at` | `timestamp with time zone` | non | — |
| `attempt_no` | `integer` | oui | `0` |
| `outcome_code` | `text` | non | — |
| `leg_reported` | `boolean` | oui | `false` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payment_post_trip_charge_pkey` : `PRIMARY KEY (id)`
- `post_trip_charge_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `post_trip_charge_amount_positive` : `CHECK (amount_minor > 0)`
- `post_trip_charge_attempt_nonneg` : `CHECK (attempt_no >= 0)`
- `post_trip_charge_attempt_shape` : `CHECK ((attempt_no = 0) = (first_attempt_at IS NULL) AND (attempt_no = 0) = (network IS NULL))`
- `post_trip_charge_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `post_trip_charge_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `post_trip_charge_host_nonneg` : `CHECK (leg_host_minor >= 0)`
- `post_trip_charge_insurer_nonneg` : `CHECK (leg_insurer_minor >= 0)`
- `post_trip_charge_legs_sum` : `CHECK ((leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor) = amount_minor)`
- `post_trip_charge_network_valid` : `CHECK (network IS NULL OR (network = ANY (ARRAY['VISA'::text, 'MASTERCARD'::text, 'AMEX'::text])))`
- `post_trip_charge_origin_format` : `CHECK (origin_type ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `post_trip_charge_origin_unique` : `UNIQUE (origin_type, origin_id)`
- `post_trip_charge_outcome_format` : `CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `post_trip_charge_platform_nonneg` : `CHECK (leg_platform_minor >= 0)`
- `post_trip_charge_purpose_valid` : `CHECK (purpose = ANY (ARRAY['RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text, 'INCIDENTAL'::text, 'DAMAGE'::text, 'OTHER_DEBT'::text]))`
- `post_trip_charge_reason_purpose` : `CHECK ((reason = 'DAMAGE_SEPARATE'::text) = (purpose = 'DAMAGE'::text) AND (reason <> 'NO_SHOW'::text OR (purpose = ANY (ARRAY['RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text]))) AND (reason <> 'DELAYED_CHARGES'::text OR (purpose = ANY (ARRAY['INCIDENTAL'::text, 'OTHER_DEBT'::text]))))`
- `post_trip_charge_reason_valid` : `CHECK (reason = ANY (ARRAY['DELAYED_CHARGES'::text, 'NO_SHOW'::text, 'DAMAGE_SEPARATE'::text]))`
- `post_trip_charge_status_valid` : `CHECK (status = ANY (ARRAY['NOTIFIED'::text, 'CHARGING'::text, 'RETRY_DUE'::text, 'CHARGED'::text, 'UNPAID'::text]))`
- `post_trip_charge_tax_nonneg` : `CHECK (leg_tax_third_party_minor >= 0)`
- `post_trip_charge_tender_fk` : `FOREIGN KEY (tender_operation_id) REFERENCES core.payment_payment_operation(id)`
- `post_trip_charge_trip_fk` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `post_trip_charge_user_fk` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `post_trip_charge_version_positive` : `CHECK (settlement_version IS NULL OR settlement_version >= 1)`

Index :

- `post_trip_charge_due_idx` : `CREATE INDEX post_trip_charge_due_idx ON core.payment_post_trip_charge USING btree (next_check_at) WHERE ((status = ANY (ARRAY['NOTIFIED'::text, 'CHARGING'::text, 'RETRY_DUE'::text])) OR (NOT leg_reported))`
- `post_trip_charge_trip_idx` : `CREATE INDEX post_trip_charge_trip_idx ON core.payment_post_trip_charge USING btree (trip_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'NOTIFIED'::text) AND (attempt_no = 0) AND (NOT leg_reported))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_charge_guard` : `CREATE TRIGGER mit_charge_guard BEFORE UPDATE ON core.payment_post_trip_charge FOR EACH ROW EXECUTE FUNCTION core.payment_post_trip_charge_guard()`
- `mit_charge_no_delete` : `CREATE TRIGGER mit_charge_no_delete BEFORE DELETE ON core.payment_post_trip_charge FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_charge_no_truncate` : `CREATE TRIGGER mit_charge_no_truncate BEFORE TRUNCATE ON core.payment_post_trip_charge FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_post_trip_charge_attempt`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `charge_id` | `uuid` | oui | — |
| `attempt_no` | `integer` | oui | — |
| `idem_plain` | `text` | oui | — |
| `idem_sent` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `operation_id` | `uuid` | non | — |
| `planned_at` | `timestamp with time zone` | oui | `platform.now()` |
| `settled` | `text` | non | — |
| `do_not_retry` | `boolean` | non | — |

Contraintes :

- `payment_post_trip_charge_attempt_pkey` : `PRIMARY KEY (charge_id, attempt_no)`
- `post_trip_attempt_amount_positive` : `CHECK (amount_minor > 0)`
- `post_trip_attempt_charge_fk` : `FOREIGN KEY (charge_id) REFERENCES core.payment_post_trip_charge(id)`
- `post_trip_attempt_idem_sent_format` : `CHECK (idem_sent ~ '^[0-9a-f]{64}$'::text)`
- `post_trip_attempt_idem_unique` : `UNIQUE (idem_plain)`
- `post_trip_attempt_no_positive` : `CHECK (attempt_no >= 1)`
- `post_trip_attempt_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `post_trip_attempt_operation_unique` : `UNIQUE (operation_id)`
- `post_trip_attempt_settled_valid` : `CHECK (settled IS NULL OR (settled = ANY (ARRAY['SUCCEEDED'::text, 'FAILED'::text])))`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (operation_id IS NULL) AND (settled IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `mit_attempt_guard` : `CREATE TRIGGER mit_attempt_guard BEFORE UPDATE ON core.payment_post_trip_charge_attempt FOR EACH ROW EXECUTE FUNCTION core.payment_post_trip_attempt_guard()`
- `mit_attempt_no_delete` : `CREATE TRIGGER mit_attempt_no_delete BEFORE DELETE ON core.payment_post_trip_charge_attempt FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only()`
- `mit_attempt_no_truncate` : `CREATE TRIGGER mit_attempt_no_truncate BEFORE TRUNCATE ON core.payment_post_trip_charge_attempt FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only()`

### `core.payment_psp_account`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `provider` | `text` | oui | — |
| `owner_type` | `text` | oui | `'PLATFORM'::text` |
| `country_code` | `text` | oui | — |
| `environment` | `text` | oui | — |
| `collection_mode` | `text` | oui | `'SPLIT_AT_SOURCE'::text` |
| `credentials_ref` | `text` | non | — |
| `webhook_secret_ref` | `text` | non | — |
| `public_webhook_id` | `text` | oui | — |
| `status` | `text` | oui | `'PENDING_VALIDATION'::text` |
| `gate_decision_ref` | `text` | non | — |
| `last_webhook_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `payment_psp_account_pkey` : `PRIMARY KEY (id)`
- `psp_account_collection_mode_valid` : `CHECK (collection_mode = ANY (ARRAY['SPLIT_AT_SOURCE'::text, 'PLATFORM_MOR'::text]))`
- `psp_account_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `psp_account_credentials_ref_format` : `CHECK (credentials_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,255}$'::text)`
- `psp_account_environment_valid` : `CHECK (environment = ANY (ARRAY['SANDBOX'::text, 'LIVE'::text]))`
- `psp_account_fake_sandbox_only` : `CHECK (provider <> 'FAKE'::text OR environment = 'SANDBOX'::text)`
- `psp_account_live_gate` : `CHECK (status <> 'ACTIVE'::text OR environment <> 'LIVE'::text OR gate_decision_ref IS NOT NULL)`
- `psp_account_owner_platform` : `CHECK (owner_type = 'PLATFORM'::text)`
- `psp_account_platform_mor_closed` : `CHECK (collection_mode <> 'PLATFORM_MOR'::text)`
- `psp_account_provider_valid` : `CHECK (provider = ANY (ARRAY['TILOPAY'::text, 'DLOCAL'::text, 'BAC'::text, 'PAGUELOFACIL'::text, 'BANCARD_VPOS'::text, 'UPAY'::text, 'EBANX'::text, 'FAKE'::text]))`
- `psp_account_public_webhook_id_format` : `CHECK (public_webhook_id ~ '^[A-Za-z0-9_-]{16,64}$'::text)`
- `psp_account_public_webhook_id_unique` : `UNIQUE (public_webhook_id)`
- `psp_account_status_valid` : `CHECK (status = ANY (ARRAY['PENDING_VALIDATION'::text, 'ACTIVE'::text, 'SUSPENDED'::text]))`
- `psp_account_webhook_secret_ref_format` : `CHECK (webhook_secret_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,255}$'::text)`

Index :

- `psp_account_one_active` : `CREATE UNIQUE INDEX psp_account_one_active ON core.payment_psp_account USING btree (provider, country_code, environment) WHERE (status = 'ACTIVE'::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `true` WITH CHECK `true`
- `kyc_cmd_host_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `psp_account_fake_guard` : `CREATE TRIGGER psp_account_fake_guard BEFORE INSERT OR UPDATE ON core.payment_psp_account FOR EACH ROW EXECUTE FUNCTION core.payment_psp_account_fake_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_psp_account FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_psp_capability`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_hold_owner: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `provider` | `text` | oui | — |
| `country_code` | `text` | oui | — |
| `method` | `text` | oui | — |
| `network` | `text` | oui | `'*'::text` |
| `capability` | `text` | oui | — |
| `value` | `jsonb` | oui | — |
| `status` | `text` | oui | — |
| `source` | `text` | oui | — |
| `validated_at` | `timestamp with time zone` | non | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `psp_capability_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `psp_capability_method_valid` : `CHECK (method = ANY (ARRAY['*'::text, 'CARD'::text, 'YAPPY'::text, 'CLAVE'::text, 'QR'::text, 'PIX'::text, 'BANK_TRANSFER'::text]))`
- `psp_capability_name_format` : `CHECK (capability ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `psp_capability_network_valid` : `CHECK (network = ANY (ARRAY['*'::text, 'VISA'::text, 'MASTERCARD'::text, 'AMEX'::text]))`
- `psp_capability_pkey` : `PRIMARY KEY (provider, country_code, method, network, capability, valid_from)`
- `psp_capability_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `psp_capability_source_present` : `CHECK (source <> ''::text)`
- `psp_capability_status_valid` : `CHECK (status = ANY (ARRAY['VALIDATED_SANDBOX'::text, 'VALIDATED_CONTRACT'::text, 'DOCUMENTED'::text, 'UNKNOWN'::text]))`
- `psp_capability_validated_dated` : `CHECK ((status <> ALL (ARRAY['VALIDATED_SANDBOX'::text, 'VALIDATED_CONTRACT'::text])) OR validated_at IS NOT NULL)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `kyc_cmd_host_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `reference_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`

### `core.payment_psp_capability_catalog`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_hold_owner: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `capability` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `blocking` | `text` | oui | — |
| `source` | `text` | oui | — |

Contraintes :

- `payment_psp_capability_catalog_pkey` : `PRIMARY KEY (capability)`
- `psp_capability_catalog_blocking_valid` : `CHECK (blocking = ANY (ARRAY['YES'::text, 'NO'::text, 'VARIANT_A'::text]))`
- `psp_capability_catalog_kind_valid` : `CHECK (kind = ANY (ARRAY['bool'::text, 'int'::text, 'enum'::text]))`
- `psp_capability_catalog_name_format` : `CHECK (capability ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `psp_capability_catalog_source_present` : `CHECK (source <> ''::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `kyc_cmd_host_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `reference_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`

### `core.payment_psp_submerchant`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `psp_account_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `attempt_no` | `integer` | oui | — |
| `idem_plain` | `text` | oui | — |
| `provider_submerchant_ref` | `text` | non | — |
| `kyc_status` | `text` | oui | `'PENDING'::text` |
| `payout_currency` | `text` | oui | — |
| `activated_at` | `timestamp with time zone` | non | — |
| `suspended_reason` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `payment_psp_submerchant_pkey` : `PRIMARY KEY (id)`
- `psp_submerchant_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `psp_submerchant_active_dated` : `CHECK (kyc_status <> 'ACTIVE'::text OR activated_at IS NOT NULL)`
- `psp_submerchant_active_ref` : `CHECK ((kyc_status <> ALL (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])) OR provider_submerchant_ref IS NOT NULL)`
- `psp_submerchant_attempt_positive` : `CHECK (attempt_no >= 1)`
- `psp_submerchant_attempt_unique` : `UNIQUE (psp_account_id, org_id, attempt_no)`
- `psp_submerchant_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `psp_submerchant_currency_format` : `CHECK (payout_currency ~ '^[A-Z]{3}$'::text)`
- `psp_submerchant_idem_unique` : `UNIQUE (idem_plain)`
- `psp_submerchant_kyc_status_valid` : `CHECK (kyc_status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'REJECTED'::text]))`
- `psp_submerchant_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `psp_submerchant_reason_code` : `CHECK (suspended_reason IS NULL OR suspended_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `psp_submerchant_reason_length` : `CHECK (length(suspended_reason) >= 1 AND length(suspended_reason) <= 200)`
- `psp_submerchant_ref_format` : `CHECK (provider_submerchant_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `psp_submerchant_suspended_reason` : `CHECK ((kyc_status = 'SUSPENDED'::text) = (suspended_reason IS NOT NULL))`

Index :

- `psp_submerchant_one_live` : `CREATE UNIQUE INDEX psp_submerchant_one_live ON core.payment_psp_submerchant USING btree (psp_account_id, org_id) WHERE (kyc_status <> 'REJECTED'::text)`
- `psp_submerchant_org_idx` : `CREATE INDEX psp_submerchant_org_idx ON core.payment_psp_submerchant USING btree (org_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (kyc_status = 'PENDING'::text) AND (provider_submerchant_ref IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `kyc_cmd_host_read` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `submerchant_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND app.is_org_holder())`
- `submerchant_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'payout'::text, 'reconciliation'::text])))`

Déclencheurs :

- `psp_submerchant_guard` : `CREATE TRIGGER psp_submerchant_guard BEFORE DELETE OR UPDATE ON core.payment_psp_submerchant FOR EACH ROW EXECUTE FUNCTION core.payment_psp_submerchant_guard()`
- `psp_submerchant_no_truncate` : `CREATE TRIGGER psp_submerchant_no_truncate BEFORE TRUNCATE ON core.payment_psp_submerchant FOR EACH STATEMENT EXECUTE FUNCTION core.payment_psp_submerchant_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_psp_submerchant FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_refund_instance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `origin_type` | `text` | oui | — |
| `origin_id` | `uuid` | oui | — |
| `settlement_id` | `uuid` | non | — |
| `settlement_version` | `integer` | non | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `refunded_operation_id` | `uuid` | oui | — |
| `instance_seq` | `integer` | oui | — |
| `attempt_no` | `integer` | oui | `1` |
| `executor` | `text` | oui | `'PLATFORM_API'::text` |
| `rail` | `text` | oui | — |
| `requested_legs` | `jsonb` | oui | — |
| `amount_trip_minor` | `bigint` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `advance_id` | `uuid` | non | — |
| `status` | `text` | oui | `'PLANNED'::text` |
| `blocked_reason` | `text` | non | — |
| `issued_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |
| `fin_alert` | `text` | non | — |

Contraintes :

- `payment_refund_instance_pkey` : `PRIMARY KEY (id)`
- `refund_instance_advance_fk` : `FOREIGN KEY (advance_id) REFERENCES core.settlement_platform_advance(id)`
- `refund_instance_amount_positive` : `CHECK (amount_trip_minor > 0)`
- `refund_instance_attempt_positive` : `CHECK (attempt_no >= 1)`
- `refund_instance_blocked_reason_valid` : `CHECK (blocked_reason = ANY (ARRAY['ADVANCE_CAP_UNSET'::text, 'HOST_ADVANCE_CAP'::text, 'PLATFORM_BALANCE_UNKNOWN'::text]))`
- `refund_instance_blocked_shape` : `CHECK (blocked_reason IS NULL OR status = 'PLANNED'::text AND advance_id IS NOT NULL)`
- `refund_instance_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `refund_instance_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `refund_instance_executor_platform` : `CHECK (executor = 'PLATFORM_API'::text)`
- `refund_instance_fin_alert_format` : `CHECK (fin_alert ~ '^[A-Z][A-Z0-9_:]{0,79}$'::text)`
- `refund_instance_issued_shape` : `CHECK ((status <> 'PLANNED'::text OR issued_at IS NULL) AND ((status <> ALL (ARRAY['SUBMITTED'::text, 'SENT'::text, 'CONFIRMED'::text, 'FAILED'::text])) OR issued_at IS NOT NULL))`
- `refund_instance_key` : `UNIQUE (origin_type, origin_id, refunded_operation_id, instance_seq)`
- `refund_instance_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id) DEFERRABLE INITIALLY DEFERRED`
- `refund_instance_operation_unique` : `UNIQUE (operation_id)`
- `refund_instance_origin_beta` : `CHECK (origin_type = 'SETTLEMENT'::text)`
- `refund_instance_origin_valid` : `CHECK (origin_type = ANY (ARRAY['SETTLEMENT'::text, 'DEPOSIT'::text, 'DAMAGE_OVERCHARGE'::text, 'INCIDENTAL_REVISION'::text, 'HOLD_COMPENSATION'::text]))`
- `refund_instance_rail_valid` : `CHECK (rail = ANY (ARRAY['NATIVE_PARTIAL'::text, 'ROLLBACK_AND_RECHARGE'::text, 'BANK_TRANSFER'::text, 'CREDIT_CASH'::text]))`
- `refund_instance_refunded_operation_fk` : `FOREIGN KEY (refunded_operation_id) REFERENCES core.payment_payment_operation(id)`
- `refund_instance_seq_positive` : `CHECK (instance_seq >= 1)`
- `refund_instance_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, settlement_version) REFERENCES core.settlement_settlement(id, trip_id, version)`
- `refund_instance_settlement_shape` : `CHECK ((origin_type = 'SETTLEMENT'::text) = (settlement_id IS NOT NULL) AND (settlement_id IS NULL) = (settlement_version IS NULL) AND (settlement_id IS NULL OR origin_id = settlement_id))`
- `refund_instance_status_valid` : `CHECK (status = ANY (ARRAY['PLANNED'::text, 'BLOCKED_CHARGEBACK'::text, 'PENDING_CUSTOMER_CHOICE'::text, 'PENDING_BANK_DETAILS'::text, 'SUBMITTED'::text, 'SENT'::text, 'CONFIRMED'::text, 'FAILED'::text, 'CREDITED'::text, 'CANCELLED'::text, 'SUPERSEDED'::text]))`
- `refund_instance_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`

Index :

- `refund_instance_advance_idx` : `CREATE INDEX refund_instance_advance_idx ON core.payment_refund_instance USING btree (advance_id) WHERE (advance_id IS NOT NULL)`
- `refund_instance_trip_idx` : `CREATE INDEX refund_instance_trip_idx ON core.payment_refund_instance USING btree (trip_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'PLANNED'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_sync` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text) AND (status = ANY (ARRAY['SUBMITTED'::text, 'SENT'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text) AND (status = ANY (ARRAY['SENT'::text, 'CONFIRMED'::text, 'FAILED'::text])))`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text])))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'reconciliation'::text])))`

Déclencheurs :

- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.payment_refund_instance FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.payment_refund_instance FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `refund_instance_guard` : `CREATE TRIGGER refund_instance_guard BEFORE INSERT OR UPDATE ON core.payment_refund_instance FOR EACH ROW EXECUTE FUNCTION core.payment_refund_instance_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_refund_instance FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_webhook_inbox`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `provider` | `text` | oui | — |
| `psp_account_id` | `uuid` | non | — |
| `provider_event_id` | `text` | non | — |
| `dedup_key` | `bytea` | oui | — |
| `received_at` | `timestamp with time zone` | oui | `platform.now()` |
| `signature_valid` | `boolean` | oui | — |
| `headers` | `jsonb` | non | — |
| `raw_body_enc` | `bytea` | non | — |
| `processing_status` | `text` | oui | `'RECEIVED'::text` |
| `processed_at` | `timestamp with time zone` | non | — |
| `error` | `text` | non | — |
| `normalized_events` | `jsonb` | non | — |
| `processing_attempts` | `integer` | oui | `0` |
| `received_by_command` | `boolean` | oui | `false` |
| `signed_at_out_of_tolerance` | `boolean` | oui | `false` |

Contraintes :

- `payment_webhook_inbox_pkey` : `PRIMARY KEY (id)`
- `webhook_inbox_dedup` : `UNIQUE NULLS NOT DISTINCT (provider, psp_account_id, dedup_key)`
- `webhook_inbox_no_pan` : `CHECK (NOT core.payment_text_has_pan(headers::text) AND NOT core.payment_text_has_pan(normalized_events::text) AND NOT core.payment_text_has_pan(provider_event_id))`
- `webhook_inbox_normalized_events_array` : `CHECK (normalized_events IS NULL OR jsonb_typeof(normalized_events) = 'array'::text)`
- `webhook_inbox_processing_attempts_nonneg` : `CHECK (processing_attempts >= 0)`
- `webhook_inbox_processing_status_valid` : `CHECK (processing_status = ANY (ARRAY['RECEIVED'::text, 'PROCESSED'::text, 'DUPLICATE'::text, 'QUARANTINED'::text, 'FAILED'::text, 'REJECTED_SIGNATURE'::text]))`
- `webhook_inbox_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `webhook_inbox_psp_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`

Index :

- `webhook_inbox_psp_account_idx` : `CREATE INDEX webhook_inbox_psp_account_idx ON core.payment_webhook_inbox USING btree (psp_account_id) WHERE (psp_account_id IS NOT NULL)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `(psp_account_id IS NOT NULL)`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_ingest` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text) AND (NOT received_by_command))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['webhook_ingest'::text, 'booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'ops_monitor'::text])))`
- `worker_update_ingest` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text))`

Déclencheurs :

- `webhook_inbox_proof_columns_immutable` : `CREATE TRIGGER webhook_inbox_proof_columns_immutable BEFORE UPDATE ON core.payment_webhook_inbox FOR EACH ROW EXECUTE FUNCTION core.payment_webhook_inbox_proof_columns_guard()`

### `core.payout_payout_account`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `org_id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `rail_kind` | `text` | oui | — |
| `institution_code` | `text` | oui | — |
| `account_number_enc` | `bytea` | oui | — |
| `account_key_subject_type` | `text` | oui | `'ORG'::text` |
| `account_key_subject_id` | `uuid` | oui | — |
| `account_last4` | `text` | oui | — |
| `holder_name` | `text` | oui | — |
| `holder_tax_id_kind` | `text` | oui | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `reject_reason` | `text` | non | — |
| `provider_ref` | `text` | non | — |
| `verified_at` | `timestamp with time zone` | non | — |
| `change_hold_until` | `timestamp with time zone` | non | — |
| `replaced_at` | `timestamp with time zone` | non | — |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payout_payout_account_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payout_payout_account_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `payout_payout_account_envelope` : `CHECK (octet_length(account_number_enc) >= 30 AND octet_length(account_number_enc) <= 128 AND get_byte(account_number_enc, 0) = 1)`
- `payout_payout_account_holder_length` : `CHECK (length(holder_name) >= 3 AND length(holder_name) <= 201)`
- `payout_payout_account_institution_format` : `CHECK (institution_code ~ '^[A-Z0-9][A-Z0-9_]{1,31}$'::text)`
- `payout_payout_account_key_is_org` : `CHECK (account_key_subject_id = org_id)`
- `payout_payout_account_key_type_valid` : `CHECK (account_key_subject_type = 'ORG'::text)`
- `payout_payout_account_last4_format` : `CHECK (account_last4 ~ '^[0-9A-Z]{4}$'::text)`
- `payout_payout_account_org_fk` : `FOREIGN KEY (org_id, user_id) REFERENCES core.iam_organization(id, holder_user_id)`
- `payout_payout_account_pkey` : `PRIMARY KEY (id)`
- `payout_payout_account_rail_valid` : `CHECK (rail_kind = ANY (ARRAY['BANK_ACCOUNT'::text, 'WALLET'::text]))`
- `payout_payout_account_reason_valid` : `CHECK (reject_reason = ANY (ARRAY['HOLDER_MISMATCH'::text, 'TAX_ID_MISMATCH'::text, 'ACCOUNT_INVALID'::text]))`
- `payout_payout_account_ref_format` : `CHECK (provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `payout_payout_account_rejected_reason` : `CHECK ((status = 'REJECTED'::text) = (reject_reason IS NOT NULL))`
- `payout_payout_account_replaced_dated` : `CHECK ((status = 'REPLACED'::text) = (replaced_at IS NOT NULL))`
- `payout_payout_account_row_version_valid` : `CHECK (row_version >= 0)`
- `payout_payout_account_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'VERIFIED'::text, 'REJECTED'::text, 'REPLACED'::text]))`
- `payout_payout_account_tax_kind_format` : `CHECK (holder_tax_id_kind ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `payout_payout_account_verified_dated` : `CHECK (status <> 'VERIFIED'::text OR verified_at IS NOT NULL)`

Index :

- `payout_payout_account_one_current` : `CREATE UNIQUE INDEX payout_payout_account_one_current ON core.payout_payout_account USING btree (org_id) WHERE (status = ANY (ARRAY['PENDING'::text, 'VERIFIED'::text]))`
- `payout_payout_account_org_idx` : `CREATE INDEX payout_payout_account_org_idx ON core.payout_payout_account USING btree (org_id, created_at DESC)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((status = 'PENDING'::text) AND (verified_at IS NULL) AND (provider_ref IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `(status = ANY (ARRAY['PENDING'::text, 'VERIFIED'::text]))` WITH CHECK `(status = ANY (ARRAY['VERIFIED'::text, 'REJECTED'::text, 'REPLACED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `payout_payout_account_guard` : `CREATE TRIGGER payout_payout_account_guard BEFORE DELETE OR UPDATE ON core.payout_payout_account FOR EACH ROW EXECUTE FUNCTION core.payout_payout_account_guard()`
- `payout_payout_account_no_truncate` : `CREATE TRIGGER payout_payout_account_no_truncate BEFORE TRUNCATE ON core.payout_payout_account FOR EACH STATEMENT EXECUTE FUNCTION core.payout_payout_account_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payout_payout_account FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payout_payout_batch`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `kind` | `text` | oui | `'FINAL'::text` |
| `variant` | `text` | oui | — |
| `psp_account_id` | `uuid` | oui | — |
| `payout_account_id` | `uuid` | non | — |
| `first_payout` | `boolean` | oui | — |
| `status` | `text` | oui | — |
| `scheduled_for` | `timestamp with time zone` | oui | — |
| `gross_minor` | `bigint` | oui | `0` |
| `netted_minor` | `bigint` | oui | `0` |
| `net_minor` | `bigint` | oui | `0` |
| `hold_reasons` | `text[]` | oui | `ARRAY[]::text[]` |
| `netted_at` | `timestamp with time zone` | non | — |
| `next_check_at` | `timestamp with time zone` | non | — |
| `attempt_no` | `integer` | oui | `0` |
| `idempotency_key` | `text` | non | — |
| `provider_ref` | `text` | non | — |
| `initiated_at` | `timestamp with time zone` | non | — |
| `paid_at` | `timestamp with time zone` | non | — |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `adjustment_status` | `text` | non | — |
| `adjustment_key` | `text` | non | — |
| `adjustment_provider_ref` | `text` | non | — |

Contraintes :

- `payout_batch_adjustment_key_format` : `CHECK (adjustment_key ~ '^adjust:[0-9a-f-]{36}:r1$'::text)`
- `payout_batch_adjustment_key_unique` : `UNIQUE (adjustment_key)`
- `payout_batch_adjustment_ref_format` : `CHECK (adjustment_provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `payout_batch_adjustment_shape` : `CHECK ((adjustment_status IS NULL) = (adjustment_key IS NULL) AND (adjustment_status IS NULL OR netted_minor > 0 AND netted_at IS NOT NULL))`
- `payout_batch_adjustment_status_valid` : `CHECK (adjustment_status = ANY (ARRAY['SUBMITTED'::text, 'SUCCEEDED'::text, 'FAILED'::text]))`
- `payout_batch_amounts` : `CHECK (gross_minor >= 0 AND netted_minor >= 0 AND netted_minor <= gross_minor AND net_minor = (gross_minor - netted_minor))`
- `payout_batch_attempt_valid` : `CHECK (attempt_no >= 0)`
- `payout_batch_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payout_batch_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `payout_batch_hold_shape` : `CHECK ((status = 'ON_HOLD'::text) = (cardinality(hold_reasons) > 0))`
- `payout_batch_idempotency_key_format` : `CHECK (idempotency_key ~ '^payout:[0-9a-f-]{36}:r[1-9][0-9]{0,5}$'::text)`
- `payout_batch_idempotency_key_unique` : `UNIQUE (idempotency_key)`
- `payout_batch_kind_valid` : `CHECK (kind = ANY (ARRAY['FINAL'::text, 'CXL_EARNINGS'::text, 'INVOICE_SHARE'::text, 'PARTIAL_WEEKLY'::text]))`
- `payout_batch_ledger_scope_unique` : `UNIQUE (id, org_id, country_code, currency)`
- `payout_batch_netted_shape` : `CHECK ((status <> ALL (ARRAY['NETTING'::text, 'READY'::text, 'ZERO_NET'::text, 'INITIATED'::text, 'IN_TRANSIT'::text, 'PAID'::text, 'FAILED'::text])) OR netted_at IS NOT NULL)`
- `payout_batch_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `payout_batch_paid_shape` : `CHECK ((status = 'PAID'::text) = (paid_at IS NOT NULL))`
- `payout_batch_payout_account_fk` : `FOREIGN KEY (payout_account_id) REFERENCES core.payout_payout_account(id)`
- `payout_batch_provider_ref_format` : `CHECK (provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `payout_batch_psp_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `payout_batch_ready_net` : `CHECK ((status <> ALL (ARRAY['READY'::text, 'INITIATED'::text, 'IN_TRANSIT'::text, 'PAID'::text])) OR net_minor > 0)`
- `payout_batch_row_version_valid` : `CHECK (row_version >= 0)`
- `payout_batch_sent_shape` : `CHECK ((status <> ALL (ARRAY['INITIATED'::text, 'IN_TRANSIT'::text, 'PAID'::text])) OR idempotency_key IS NOT NULL AND initiated_at IS NOT NULL AND attempt_no >= 1)`
- `payout_batch_status_valid` : `CHECK (status = ANY (ARRAY['SCHEDULED'::text, 'ON_HOLD'::text, 'NETTING'::text, 'READY'::text, 'ZERO_NET'::text, 'INITIATED'::text, 'IN_TRANSIT'::text, 'PAID'::text, 'FAILED'::text]))`
- `payout_batch_variant_valid` : `CHECK (variant = ANY (ARRAY['SPLIT_AT_SOURCE'::text, 'PLATFORM_MOR'::text]))`
- `payout_batch_zero_net` : `CHECK (status <> 'ZERO_NET'::text OR net_minor = 0)`
- `payout_payout_batch_pkey` : `PRIMARY KEY (id)`

Index :

- `payout_payout_batch_due_idx` : `CREATE INDEX payout_payout_batch_due_idx ON core.payout_payout_batch USING btree (scheduled_for) WHERE (status <> ALL (ARRAY['PAID'::text, 'ZERO_NET'::text]))`
- `payout_payout_batch_open_unique` : `CREATE UNIQUE INDEX payout_payout_batch_open_unique ON core.payout_payout_batch USING btree (org_id, currency, kind, scheduled_for, psp_account_id) WHERE (netted_at IS NULL)`
- `payout_payout_batch_org_idx` : `CREATE INDEX payout_payout_batch_org_idx ON core.payout_payout_batch USING btree (org_id, currency)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = ANY (ARRAY['SCHEDULED'::text, 'ON_HOLD'::text])) AND (netted_at IS NULL) AND (idempotency_key IS NULL) AND (attempt_no = 0))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `payout_batch_adjustment_guard` : `CREATE TRIGGER payout_batch_adjustment_guard BEFORE UPDATE ON core.payout_payout_batch FOR EACH ROW EXECUTE FUNCTION core.payout_payout_batch_adjustment_guard()`
- `payout_payout_batch_guard` : `CREATE TRIGGER payout_payout_batch_guard BEFORE INSERT OR DELETE OR UPDATE ON core.payout_payout_batch FOR EACH ROW EXECUTE FUNCTION core.payout_payout_batch_guard()`
- `payout_payout_batch_no_truncate` : `CREATE TRIGGER payout_payout_batch_no_truncate BEFORE TRUNCATE ON core.payout_payout_batch FOR EACH STATEMENT EXECUTE FUNCTION core.payout_payout_batch_guard()`

### `core.payout_payout_item`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `batch_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `leg` | `text` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | `0` |
| `release_attempt` | `integer` | oui | `0` |
| `release_operation_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payout_item_amount_nonneg` : `CHECK (amount_minor >= 0)`
- `payout_item_attempt_valid` : `CHECK (release_attempt >= 0)`
- `payout_item_batch_fk` : `FOREIGN KEY (batch_id) REFERENCES core.payout_payout_batch(id)`
- `payout_item_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payout_item_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `payout_item_leg_host` : `CHECK (leg = 'HOST'::text)`
- `payout_item_release_operation_fk` : `FOREIGN KEY (release_operation_id) REFERENCES core.payment_payment_operation(id)`
- `payout_item_release_operation_unique` : `UNIQUE (release_operation_id)`
- `payout_item_release_shape` : `CHECK (release_operation_id IS NULL OR release_attempt >= 1)`
- `payout_item_segment_beta` : `CHECK (segment_no = 1)`
- `payout_item_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `payout_item_trip_leg_unique` : `UNIQUE (trip_id, segment_no, leg)`
- `payout_payout_item_pkey` : `PRIMARY KEY (id)`

Index :

- `payout_payout_item_batch_idx` : `CREATE INDEX payout_payout_item_batch_idx ON core.payout_payout_item USING btree (batch_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (release_operation_id IS NULL) AND (release_attempt = 0))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `payout_payout_item_guard` : `CREATE TRIGGER payout_payout_item_guard BEFORE DELETE OR UPDATE ON core.payout_payout_item FOR EACH ROW EXECUTE FUNCTION core.payout_payout_item_guard()`
- `payout_payout_item_no_truncate` : `CREATE TRIGGER payout_payout_item_no_truncate BEFORE TRUNCATE ON core.payout_payout_item FOR EACH STATEMENT EXECUTE FUNCTION core.payout_payout_item_guard()`

### `core.payout_prepare_deferral`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `outcome` | `text` | oui | — |
| `attempts` | `integer` | oui | `1` |
| `next_attempt_at` | `timestamp with time zone` | oui | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payout_prepare_deferral_attempts_valid` : `CHECK (attempts >= 1)`
- `payout_prepare_deferral_outcome_format` : `CHECK (outcome ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `payout_prepare_deferral_pkey` : `PRIMARY KEY (trip_id)`
- `payout_prepare_deferral_trip_fk` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Index :

- `payout_prepare_deferral_next_idx` : `CREATE INDEX payout_prepare_deferral_next_idx ON core.payout_prepare_deferral USING btree (next_attempt_at)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.pricing_quote`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `listing_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `status` | `text` | oui | `'FROZEN'::text` |
| `engine_version` | `text` | oui | — |
| `period` | `tstzrange` | oui | — |
| `billable_days` | `integer` | oui | — |
| `subtotal_minor` | `bigint` | oui | — |
| `tax_total_minor` | `bigint` | oui | — |
| `tax_third_party_minor` | `bigint` | oui | — |
| `total_minor` | `bigint` | oui | — |
| `leg_host_minor` | `bigint` | oui | — |
| `leg_insurer_minor` | `bigint` | oui | — |
| `leg_tax_third_party_minor` | `bigint` | oui | — |
| `leg_platform_minor` | `bigint` | oui | — |
| `inputs` | `text` | oui | — |
| `inputs_hash` | `text` | oui | — |
| `outputs` | `text` | oui | — |
| `outputs_hash` | `text` | oui | — |
| `frozen_at` | `timestamp with time zone` | oui | `platform.now()` |
| `superseded_at` | `timestamp with time zone` | non | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `protection_level` | `text` | non | — |
| `host_plan_code` | `text` | non | — |
| `driver_age` | `smallint` | non | — |
| `mileage_mode` | `text` | non | — |
| `included_km` | `integer` | non | — |
| `extra_km_price_minor` | `bigint` | non | — |

Contraintes :

- `pricing_quote_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `pricing_quote_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `pricing_quote_days_valid` : `CHECK (billable_days >= 1)`
- `pricing_quote_driver_age_valid` : `CHECK (driver_age >= 0 AND driver_age <= 150)`
- `pricing_quote_engine_known` : `CHECK (engine_version = ANY (ARRAY['prc.quote/1'::text, 'prc.quote/2'::text, 'prc.quote/3'::text]))`
- `pricing_quote_expires_after_frozen` : `CHECK (expires_at IS NULL OR expires_at > frozen_at)`
- `pricing_quote_extra_km_price_valid` : `CHECK (extra_km_price_minor >= 0)`
- `pricing_quote_host_plan_format` : `CHECK (host_plan_code ~ '^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$'::text)`
- `pricing_quote_included_km_valid` : `CHECK (included_km >= 1)`
- `pricing_quote_inputs_hash_format` : `CHECK (inputs_hash ~ '^[0-9a-f]{64}$'::text)`
- `pricing_quote_legs_nonnegative` : `CHECK (leg_host_minor >= 0 AND leg_insurer_minor >= 0 AND leg_tax_third_party_minor >= 0 AND leg_platform_minor >= 0)`
- `pricing_quote_legs_sum` : `CHECK ((leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor) = total_minor)`
- `pricing_quote_mileage_complete` : `CHECK (mileage_mode IS NULL AND included_km IS NULL AND extra_km_price_minor IS NULL OR mileage_mode = 'UNLIMITED'::text AND included_km IS NULL AND extra_km_price_minor IS NULL OR mileage_mode = 'INCLUDED'::text AND included_km IS NOT NULL AND extra_km_price_minor IS NOT NULL)`
- `pricing_quote_mileage_mode_valid` : `CHECK (mileage_mode = ANY (ARRAY['UNLIMITED'::text, 'INCLUDED'::text]))`
- `pricing_quote_outputs_hash_format` : `CHECK (outputs_hash ~ '^[0-9a-f]{64}$'::text)`
- `pricing_quote_period_valid` : `CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period))`
- `pricing_quote_pkey` : `PRIMARY KEY (id)`
- `pricing_quote_protection_level_format` : `CHECK (protection_level ~ '^[A-Z][A-Z_]{0,31}$'::text)`
- `pricing_quote_protection_v3` : `CHECK ((engine_version = 'prc.quote/3'::text) = (protection_level IS NOT NULL) AND (engine_version = 'prc.quote/3'::text) = (host_plan_code IS NOT NULL))`
- `pricing_quote_status_valid` : `CHECK (status = ANY (ARRAY['FROZEN'::text, 'SUPERSEDED'::text]))`
- `pricing_quote_superseded` : `CHECK ((status = 'SUPERSEDED'::text) = (superseded_at IS NOT NULL))`
- `pricing_quote_third_party_leg` : `CHECK (leg_tax_third_party_minor = tax_third_party_minor)`
- `pricing_quote_total_positive` : `CHECK (total_minor > 0)`
- `pricing_quote_total_sum` : `CHECK (total_minor = (subtotal_minor + tax_total_minor))`

Index :

- `pricing_quote_guest_idx` : `CREATE INDEX pricing_quote_guest_idx ON core.pricing_quote USING btree (guest_user_id, frozen_at)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `(status = 'FROZEN'::text)` WITH CHECK `(status = 'SUPERSEDED'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `pricing_quote_guard` : `CREATE TRIGGER pricing_quote_guard BEFORE DELETE OR UPDATE ON core.pricing_quote FOR EACH ROW EXECUTE FUNCTION core.pricing_record_guard()`
- `pricing_quote_no_truncate` : `CREATE TRIGGER pricing_quote_no_truncate BEFORE TRUNCATE ON core.pricing_quote FOR EACH STATEMENT EXECUTE FUNCTION core.pricing_record_guard()`

### `core.pricing_quote_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `quote_id` | `uuid` | oui | — |
| `seq` | `integer` | oui | — |
| `line_type` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `tax_group` | `text` | non | — |
| `rate_bps` | `integer` | non | — |
| `tax_minor` | `bigint` | oui | — |
| `third_party` | `boolean` | oui | — |

Contraintes :

- `pricing_quote_line_pkey` : `PRIMARY KEY (quote_id, seq)`
- `pricing_quote_line_quote_id_fkey` : `FOREIGN KEY (quote_id) REFERENCES core.pricing_quote(id)`
- `pricing_quote_line_rate_valid` : `CHECK (rate_bps >= 0 AND rate_bps <= 10000)`
- `pricing_quote_line_seq_valid` : `CHECK (seq >= 1 AND seq <= 10)`
- `pricing_quote_line_sign` : `CHECK (amount_minor <> 0 AND (amount_minor > 0 OR (line_type = ANY (ARRAY['PROMO_PLATFORM'::text, 'PROMO_HOST'::text]))))`
- `pricing_quote_line_taxable` : `CHECK ((tax_group IS NULL) = (rate_bps IS NULL) AND (tax_group IS NOT NULL OR tax_minor = 0 AND NOT third_party))`
- `pricing_quote_line_type_unique` : `UNIQUE (quote_id, line_type)`
- `pricing_quote_line_type_valid` : `CHECK (line_type = ANY (ARRAY['TRIP_PRICE'::text, 'PROMO_PLATFORM'::text, 'PROMO_HOST'::text, 'TRIP_FEE'::text, 'PROTECTION'::text, 'EXTRAS'::text, 'ENHANCED_ROADSIDE'::text, 'ADDITIONAL_DRIVER_FEE'::text, 'YOUNG_DRIVER_FEE'::text, 'DELIVERY_FEE'::text]))`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `pricing_quote_line_guard` : `CREATE TRIGGER pricing_quote_line_guard BEFORE DELETE OR UPDATE ON core.pricing_quote_line FOR EACH ROW EXECUTE FUNCTION core.pricing_record_guard()`
- `pricing_quote_line_no_truncate` : `CREATE TRIGGER pricing_quote_line_no_truncate BEFORE TRUNCATE ON core.pricing_quote_line FOR EACH STATEMENT EXECUTE FUNCTION core.pricing_record_guard()`

### `core.pricing_tax_line_config`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `country_code` | `character(2)` | oui | — |
| `line_type` | `text` | oui | — |
| `taxable` | `boolean` | oui | — |
| `rate_group` | `text` | non | — |
| `rate_bps` | `integer` | non | — |
| `third_party` | `boolean` | oui | `false` |
| `version` | `integer` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |

Contraintes :

- `pricing_tax_line_config_check` : `CHECK (taxable = (rate_group IS NOT NULL))`
- `pricing_tax_line_config_check1` : `CHECK (taxable = (rate_bps IS NOT NULL))`
- `pricing_tax_line_config_check2` : `CHECK (taxable OR NOT third_party)`
- `pricing_tax_line_config_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `pricing_tax_line_config_line_type_check` : `CHECK (line_type = ANY (ARRAY['TRIP_PRICE'::text, 'PROMO_PLATFORM'::text, 'PROMO_HOST'::text, 'TRIP_FEE'::text, 'PROTECTION'::text, 'EXTRAS'::text, 'ENHANCED_ROADSIDE'::text, 'ADDITIONAL_DRIVER_FEE'::text, 'YOUNG_DRIVER_FEE'::text, 'DELIVERY_FEE'::text]))`
- `pricing_tax_line_config_pkey` : `PRIMARY KEY (country_code, line_type, version)`
- `pricing_tax_line_config_rate_bps_check` : `CHECK (rate_bps >= 0 AND rate_bps <= 10000)`
- `pricing_tax_line_config_version_check` : `CHECK (version > 0)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `cmd_money_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `pricing_tax_line_config_guard` : `CREATE TRIGGER pricing_tax_line_config_guard BEFORE DELETE OR UPDATE ON core.pricing_tax_line_config FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `pricing_tax_line_config_insert_guard` : `CREATE TRIGGER pricing_tax_line_config_insert_guard BEFORE INSERT ON core.pricing_tax_line_config FOR EACH ROW EXECUTE FUNCTION core.config_tax_line_guard()`
- `pricing_tax_line_config_no_truncate` : `CREATE TRIGGER pricing_tax_line_config_no_truncate BEFORE TRUNCATE ON core.pricing_tax_line_config FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.pricing_trip_price_version`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `version` | `integer` | oui | — |
| `quote_id` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `pricing_trip_price_version_pkey` : `PRIMARY KEY (trip_id, version)`
- `pricing_trip_price_version_quote_id_fkey` : `FOREIGN KEY (quote_id) REFERENCES core.pricing_quote(id)`
- `pricing_trip_price_version_quote_unique` : `UNIQUE (quote_id)`
- `pricing_trip_price_version_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `pricing_trip_price_version_valid` : `CHECK (version >= 1)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `pricing_trip_price_version_guard` : `CREATE TRIGGER pricing_trip_price_version_guard BEFORE DELETE OR UPDATE ON core.pricing_trip_price_version FOR EACH ROW EXECUTE FUNCTION core.pricing_record_guard()`
- `pricing_trip_price_version_no_truncate` : `CREATE TRIGGER pricing_trip_price_version_no_truncate BEFORE TRUNCATE ON core.pricing_trip_price_version FOR EACH STATEMENT EXECUTE FUNCTION core.pricing_record_guard()`

### `core.review_rating_aggregate`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; review_cmd_owner: INSERT, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `review_count` | `integer` | oui | — |
| `overall_sum` | `integer` | oui | — |
| `avg_overall_x100` | `integer` | oui | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `rating_aggregate_avg_exact` : `CHECK (avg_overall_x100 = ((overall_sum * 200 + review_count) / (2 * review_count)))`
- `rating_aggregate_count_positive` : `CHECK (review_count >= 1)`
- `rating_aggregate_subject_type_valid` : `CHECK (subject_type = ANY (ARRAY['VEHICLE'::text, 'HOST'::text, 'GUEST'::text]))`
- `rating_aggregate_sum_range` : `CHECK (overall_sum >= review_count AND overall_sum <= (5 * review_count))`
- `review_rating_aggregate_pkey` : `PRIMARY KEY (subject_type, subject_id)`

Politiques RLS :

- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `(subject_type = 'GUEST'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `review_cmd_ins` (INSERT, PERMISSIVE, review_cmd_owner) WITH CHECK `true`
- `review_cmd_sel` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`
- `review_cmd_upd` (UPDATE, PERMISSIVE, review_cmd_owner) USING `true` WITH CHECK `true`

Déclencheurs :

- `review_rating_aggregate_no_truncate` : `CREATE TRIGGER review_rating_aggregate_no_truncate BEFORE TRUNCATE ON core.review_rating_aggregate FOR EACH STATEMENT EXECUTE FUNCTION core.review_record_guard()`

### `core.review_review`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; review_cmd_owner: INSERT, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `author_user_id` | `uuid` | oui | — |
| `author_role` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `overall` | `smallint` | oui | — |
| `cleanliness` | `smallint` | non | — |
| `communication` | `smallint` | non | — |
| `convenience` | `smallint` | non | — |
| `accuracy` | `smallint` | non | — |
| `maintenance` | `smallint` | non | — |
| `status` | `text` | oui | — |
| `source` | `text` | oui | — |
| `manual_action_id` | `uuid` | non | — |
| `recorded_by` | `uuid` | non | — |
| `published_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `submission_id` | `uuid` | non | — |
| `body` | `text` | non | — |
| `contact_masked` | `boolean` | non | — |
| `punctuality` | `smallint` | non | — |
| `return_condition` | `smallint` | non | — |
| `rules_respect` | `smallint` | non | — |

Contraintes :

- `review_accuracy_range` : `CHECK (accuracy >= 1 AND accuracy <= 5)`
- `review_author_role_valid` : `CHECK (author_role = ANY (ARRAY['GUEST'::text, 'HOST'::text]))`
- `review_body_length` : `CHECK (body IS NULL OR char_length(body) >= 1 AND char_length(body) <= 1000)`
- `review_cleanliness_range` : `CHECK (cleanliness >= 1 AND cleanliness <= 5)`
- `review_communication_range` : `CHECK (communication >= 1 AND communication <= 5)`
- `review_convenience_range` : `CHECK (convenience >= 1 AND convenience <= 5)`
- `review_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `review_from_submission_masked` : `CHECK (submission_id IS NULL OR contact_masked IS NOT NULL)`
- `review_guest_scores_only` : `CHECK (author_role = 'GUEST'::text OR cleanliness IS NULL AND convenience IS NULL AND accuracy IS NULL AND maintenance IS NULL)`
- `review_host_scores_only` : `CHECK (author_role = 'HOST'::text OR punctuality IS NULL AND return_condition IS NULL AND rules_respect IS NULL)`
- `review_in_app_traced` : `CHECK (source <> 'IN_APP'::text OR submission_id IS NOT NULL AND manual_action_id IS NULL AND recorded_by IS NULL AND contact_masked IS NOT NULL)`
- `review_maintenance_range` : `CHECK (maintenance >= 1 AND maintenance <= 5)`
- `review_ops_recorded_traced` : `CHECK (source <> 'OPS_RECORDED'::text OR manual_action_id IS NOT NULL AND recorded_by IS NOT NULL)`
- `review_overall_range` : `CHECK (overall >= 1 AND overall <= 5)`
- `review_published_dated` : `CHECK ((status = 'PUBLISHED'::text) = (published_at IS NOT NULL) OR (status = ANY (ARRAY['HIDDEN'::text, 'REMOVED'::text])))`
- `review_punctuality_range` : `CHECK (punctuality >= 1 AND punctuality <= 5)`
- `review_return_condition_range` : `CHECK (return_condition >= 1 AND return_condition <= 5)`
- `review_review_author_fkey` : `FOREIGN KEY (author_user_id) REFERENCES core.iam_user_account(id)`
- `review_review_pkey` : `PRIMARY KEY (id)`
- `review_review_trip_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `review_rules_respect_range` : `CHECK (rules_respect >= 1 AND rules_respect <= 5)`
- `review_source_valid` : `CHECK (source = ANY (ARRAY['OPS_RECORDED'::text, 'IN_APP'::text]))`
- `review_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'PUBLISHED'::text, 'HIDDEN'::text, 'REMOVED'::text]))`
- `review_subject_matches_author` : `CHECK (author_role = 'GUEST'::text AND (subject_type = ANY (ARRAY['VEHICLE'::text, 'HOST'::text])) OR author_role = 'HOST'::text AND subject_type = 'GUEST'::text)`
- `review_subject_type_valid` : `CHECK (subject_type = ANY (ARRAY['VEHICLE'::text, 'HOST'::text, 'GUEST'::text]))`
- `review_unique_per_party` : `UNIQUE (trip_id, author_user_id, subject_type)`

Index :

- `review_review_subject_idx` : `CREATE INDEX review_review_subject_idx ON core.review_review USING btree (subject_type, subject_id)`
- `review_review_submission_idx` : `CREATE INDEX review_review_submission_idx ON core.review_review USING btree (submission_id) WHERE (submission_id IS NOT NULL)`
- `review_review_trip_idx` : `CREATE INDEX review_review_trip_idx ON core.review_review USING btree (trip_id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `review_cmd_ins` (INSERT, PERMISSIVE, review_cmd_owner) WITH CHECK `((status = 'PUBLISHED'::text) AND (source = 'OPS_RECORDED'::text))`
- `review_cmd_ins_app` (INSERT, PERMISSIVE, review_cmd_owner) WITH CHECK `((status = 'PUBLISHED'::text) AND (submission_id IS NOT NULL))`
- `review_cmd_sel` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`

Déclencheurs :

- `review_review_guard` : `CREATE TRIGGER review_review_guard BEFORE DELETE OR UPDATE ON core.review_review FOR EACH ROW EXECUTE FUNCTION core.review_record_guard()`
- `review_review_no_truncate` : `CREATE TRIGGER review_review_no_truncate BEFORE TRUNCATE ON core.review_review FOR EACH STATEMENT EXECUTE FUNCTION core.review_record_guard()`

### `core.review_submission`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; review_cmd_owner: INSERT, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `author_user_id` | `uuid` | oui | — |
| `author_role` | `text` | oui | — |
| `overall` | `smallint` | oui | — |
| `cleanliness` | `smallint` | non | — |
| `communication` | `smallint` | non | — |
| `convenience` | `smallint` | non | — |
| `accuracy` | `smallint` | non | — |
| `maintenance` | `smallint` | non | — |
| `punctuality` | `smallint` | non | — |
| `return_condition` | `smallint` | non | — |
| `rules_respect` | `smallint` | non | — |
| `body` | `text` | non | — |
| `contact_masked` | `boolean` | oui | — |
| `source` | `text` | oui | — |
| `manual_action_id` | `uuid` | non | — |
| `recorded_by` | `uuid` | non | — |
| `submitted_at` | `timestamp with time zone` | oui | — |
| `window_closes_at` | `timestamp with time zone` | oui | — |

Contraintes :

- `review_submission_accuracy` : `CHECK (accuracy >= 1 AND accuracy <= 5)`
- `review_submission_author_fkey` : `FOREIGN KEY (author_user_id) REFERENCES core.iam_user_account(id)`
- `review_submission_body_length` : `CHECK (body IS NULL OR char_length(body) >= 1 AND char_length(body) <= 1000)`
- `review_submission_cleanliness` : `CHECK (cleanliness >= 1 AND cleanliness <= 5)`
- `review_submission_communication` : `CHECK (communication >= 1 AND communication <= 5)`
- `review_submission_convenience` : `CHECK (convenience >= 1 AND convenience <= 5)`
- `review_submission_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `review_submission_guest_scores` : `CHECK (author_role = 'GUEST'::text OR cleanliness IS NULL AND convenience IS NULL AND accuracy IS NULL AND maintenance IS NULL)`
- `review_submission_host_scores` : `CHECK (author_role = 'HOST'::text OR punctuality IS NULL AND return_condition IS NULL AND rules_respect IS NULL)`
- `review_submission_maintenance` : `CHECK (maintenance >= 1 AND maintenance <= 5)`
- `review_submission_once` : `UNIQUE (trip_id, author_role)`
- `review_submission_ops_no_text` : `CHECK (source <> 'OPS_RECORDED'::text OR body IS NULL)`
- `review_submission_ops_traced` : `CHECK ((source = 'OPS_RECORDED'::text) = (manual_action_id IS NOT NULL AND recorded_by IS NOT NULL))`
- `review_submission_overall_range` : `CHECK (overall >= 1 AND overall <= 5)`
- `review_submission_pkey` : `PRIMARY KEY (id)`
- `review_submission_punctuality` : `CHECK (punctuality >= 1 AND punctuality <= 5)`
- `review_submission_return_condition` : `CHECK (return_condition >= 1 AND return_condition <= 5)`
- `review_submission_role_valid` : `CHECK (author_role = ANY (ARRAY['GUEST'::text, 'HOST'::text]))`
- `review_submission_rules_respect` : `CHECK (rules_respect >= 1 AND rules_respect <= 5)`
- `review_submission_source_valid` : `CHECK (source = ANY (ARRAY['IN_APP'::text, 'OPS_RECORDED'::text]))`
- `review_submission_text_required` : `CHECK (source <> 'IN_APP'::text OR overall > 3 OR body IS NOT NULL AND char_length(body) >= 25)`
- `review_submission_trip_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `review_submission_window` : `CHECK (submitted_at < window_closes_at)`

Index :

- `review_submission_due_idx` : `CREATE INDEX review_submission_due_idx ON core.review_submission USING btree (window_closes_at)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `review_cmd_ins` (INSERT, PERMISSIVE, review_cmd_owner) WITH CHECK `true`
- `review_cmd_sel` (SELECT, PERMISSIVE, review_cmd_owner) USING `true`

Déclencheurs :

- `review_submission_guard` : `CREATE TRIGGER review_submission_guard BEFORE DELETE OR UPDATE ON core.review_submission FOR EACH ROW EXECUTE FUNCTION core.review_record_guard()`
- `review_submission_no_truncate` : `CREATE TRIGGER review_submission_no_truncate BEFORE TRUNCATE ON core.review_submission FOR EACH STATEMENT EXECUTE FUNCTION core.review_record_guard()`

### `core.risk_abuse_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; risk_limit_owner: DELETE, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `bigint` | oui | — |
| `kind` | `text` | oui | — |
| `scope` | `text` | oui | — |
| `key_hash` | `bytea` | oui | — |
| `country_code` | `character(2)` | non | — |
| `bucket_start` | `timestamp with time zone` | oui | — |
| `first_at` | `timestamp with time zone` | oui | — |
| `last_at` | `timestamp with time zone` | oui | — |
| `occurrences` | `integer` | oui | — |
| `signals` | `text[]` | oui | `'{}'::text[]` |

Contraintes :

- `risk_abuse_event_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `risk_abuse_event_key_size` : `CHECK (octet_length(key_hash) = 32)`
- `risk_abuse_event_kind_valid` : `CHECK (kind = ANY (ARRAY['RATE_LIMITED'::text, 'SMS_DAILY_CAP_REACHED'::text, 'BOT_SUSPECTED'::text, 'BOT_CHALLENGED'::text]))`
- `risk_abuse_event_occurrences_valid` : `CHECK (occurrences >= 1 AND occurrences <= 2000000000)`
- `risk_abuse_event_pkey` : `PRIMARY KEY (id)`
- `risk_abuse_event_scope_format` : `CHECK (scope ~ '^[a-z][a-z0-9_]{1,47}$'::text)`
- `risk_abuse_event_signals_valid` : `CHECK (signals <@ ARRAY['REGULAR_RHYTHM'::text, 'NO_BROWSER_HEADERS'::text, 'SIGNUP_BURST'::text] AND array_position(signals, NULL::text) IS NULL)`
- `risk_abuse_event_times_valid` : `CHECK (first_at <= last_at AND bucket_start <= first_at)`
- `risk_abuse_event_unique` : `UNIQUE (kind, scope, key_hash, bucket_start)`

Index :

- `risk_abuse_event_board_idx` : `CREATE INDEX risk_abuse_event_board_idx ON core.risk_abuse_event USING btree (country_code, bucket_start)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_limit_all` (ALL, PERMISSIVE, risk_limit_owner) USING `true` WITH CHECK `true`

### `core.risk_account_link`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_low` | `uuid` | oui | — |
| `user_high` | `uuid` | oui | — |
| `decision` | `text` | oui | — |
| `signal` | `text` | oui | — |
| `decided_by` | `uuid` | oui | — |
| `decided_at` | `timestamp with time zone` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `risk_account_link_decided_by_fkey` : `FOREIGN KEY (decided_by) REFERENCES core.iam_user_account(id)`
- `risk_account_link_decision_valid` : `CHECK (decision = ANY (ARRAY['LINKED'::text, 'NOT_LINKED'::text]))`
- `risk_account_link_not_decider` : `CHECK (decided_by <> user_low AND decided_by <> user_high)`
- `risk_account_link_ordered` : `CHECK (user_low < user_high)`
- `risk_account_link_pair_unique` : `UNIQUE (user_low, user_high)`
- `risk_account_link_pkey` : `PRIMARY KEY (id)`
- `risk_account_link_row_version_valid` : `CHECK (row_version >= 0)`
- `risk_account_link_signal_valid` : `CHECK (signal = ANY (ARRAY['SAME_CARD'::text, 'SAME_DEVICE'::text, 'SAME_DRIVER_LICENSE'::text, 'SAME_IDENTITY'::text, 'SAME_PHONE'::text, 'OTHER'::text]))`
- `risk_account_link_user_high_fkey` : `FOREIGN KEY (user_high) REFERENCES core.iam_user_account(id)`
- `risk_account_link_user_low_fkey` : `FOREIGN KEY (user_low) REFERENCES core.iam_user_account(id)`

Index :

- `risk_account_link_high_idx` : `CREATE INDEX risk_account_link_high_idx ON core.risk_account_link USING btree (user_high)`

Politiques RLS :

- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_link_read` (SELECT, PERMISSIVE, risk_limit_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.risk_account_link FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.risk_assessment`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : aucun

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `org_id` | `uuid` | non | — |
| `rules_fired` | `jsonb` | oui | — |
| `score` | `integer` | oui | — |
| `decision` | `text` | oui | — |
| `dedupe_key` | `text` | oui | — |
| `explanation` | `text` | oui | — |
| `reviewed_by` | `uuid` | non | — |
| `decided_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `risk_assessment_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `risk_assessment_decision_valid` : `CHECK (decision = ANY (ARRAY['AUTO_OK'::text, 'REVIEW'::text, 'REJECT'::text]))`
- `risk_assessment_dedupe_format` : `CHECK (dedupe_key ~ '^[A-Z][A-Z0-9_]{1,63}:[0-9a-f-]{36}$'::text)`
- `risk_assessment_explanation_format` : `CHECK (explanation ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `risk_assessment_org_fkey` : `FOREIGN KEY (org_id) REFERENCES core.iam_organization(id)`
- `risk_assessment_pkey` : `PRIMARY KEY (id)`
- `risk_assessment_reviewed_by_fkey` : `FOREIGN KEY (reviewed_by) REFERENCES core.iam_user_account(id)`
- `risk_assessment_reviewed_coherent` : `CHECK ((reviewed_by IS NULL) = (decided_at IS NULL))`
- `risk_assessment_rules_array` : `CHECK (jsonb_typeof(rules_fired) = 'array'::text AND jsonb_array_length(rules_fired) >= 1)`
- `risk_assessment_score_range` : `CHECK (score >= 0 AND score <= 100)`
- `risk_assessment_subject_type_valid` : `CHECK (subject_type = ANY (ARRAY['HOLD'::text, 'TRIP'::text, 'USER'::text]))`

Index :

- `risk_assessment_open_unique` : `CREATE UNIQUE INDEX risk_assessment_open_unique ON core.risk_assessment USING btree (subject_type, subject_id, dedupe_key) WHERE (decided_at IS NULL)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `((subject_type = 'USER'::text) AND (decided_at IS NULL))`
- `cmd_hold_review_decide` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((subject_type = 'HOLD'::text) AND (decision = 'REVIEW'::text) AND (decided_at IS NULL))` WITH CHECK `((subject_type = 'HOLD'::text) AND (decision = 'REVIEW'::text) AND (decided_at IS NOT NULL) AND (reviewed_by IS NOT NULL))`
- `cmd_hold_review_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(subject_type = 'HOLD'::text)`
- `cmd_hold_risk_hold_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((subject_type = 'HOLD'::text) AND (decision = ANY (ARRAY['REVIEW'::text, 'AUTO_OK'::text])) AND (reviewed_by IS NULL) AND (decided_at IS NULL) AND (explanation = ANY (ARRAY['CHECKOUT_RISK_REVIEW'::text, 'CHECKOUT_RISK_AUTO_OK'::text])))`
- `cmd_hold_risk_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((subject_type = 'USER'::text) AND (decision = 'REVIEW'::text) AND (reviewed_by IS NULL) AND (decided_at IS NULL) AND (explanation = 'SELF_BOOKING_LINKED_ACCOUNT'::text) AND (app.actor_kind() = 'GUEST'::text) AND (subject_id = app.actor_id()))`
- `iam_staff_party_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.risk_rate_counter`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; risk_limit_owner: DELETE, INSERT, SELECT, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `scope` | `text` | oui | — |
| `key_hash` | `bytea` | oui | — |
| `window_start` | `timestamp with time zone` | oui | — |
| `window_end` | `timestamp with time zone` | oui | — |
| `country_code` | `character(2)` | non | — |
| `hits` | `integer` | oui | — |

Contraintes :

- `risk_rate_counter_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `risk_rate_counter_hits_valid` : `CHECK (hits >= 1 AND hits <= 2000000000)`
- `risk_rate_counter_key_size` : `CHECK (octet_length(key_hash) = 32)`
- `risk_rate_counter_pkey` : `PRIMARY KEY (scope, key_hash, window_start)`
- `risk_rate_counter_scope_format` : `CHECK (scope ~ '^[a-z][a-z0-9_]{1,47}$'::text)`
- `risk_rate_counter_window_valid` : `CHECK (window_end > window_start)`

Index :

- `risk_rate_counter_window_end_idx` : `CREATE INDEX risk_rate_counter_window_end_idx ON core.risk_rate_counter USING btree (window_end)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_limit_all` (ALL, PERMISSIVE, risk_limit_owner) USING `true` WITH CHECK `true`

### `core.risk_rule`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : aucun

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `text` | oui | — |
| `version` | `integer` | oui | — |
| `description` | `text` | oui | — |
| `severity` | `text` | oui | — |
| `active` | `boolean` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |

Contraintes :

- `risk_rule_code_format` : `CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `risk_rule_description_length` : `CHECK (char_length(btrim(description)) >= 10 AND char_length(btrim(description)) <= 500)`
- `risk_rule_pkey` : `PRIMARY KEY (code, version)`
- `risk_rule_severity_valid` : `CHECK (severity = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text]))`
- `risk_rule_version_positive` : `CHECK (version >= 1)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.settlement_chargeback_imputation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `settlement_id` | `uuid` | non | — |
| `settlement_version` | `integer` | non | — |
| `earnings_kind` | `text` | oui | — |
| `lost_trip_minor` | `bigint` | oui | — |
| `collected_before_minor` | `bigint` | oui | — |
| `refund_committed_minor` | `bigint` | oui | — |
| `owed_minor` | `bigint` | oui | — |
| `host_from_guest_minor` | `bigint` | oui | — |
| `host_paid_minor` | `bigint` | oui | — |
| `retained_before_minor` | `bigint` | oui | — |
| `retained_after_minor` | `bigint` | oui | — |
| `host_payable_after_minor` | `bigint` | oui | — |
| `clawback_minor` | `bigint` | oui | — |
| `host_unpaid_cancelled_minor` | `bigint` | oui | — |
| `guest_receivable_minor` | `bigint` | oui | — |
| `loss_expense_minor` | `bigint` | oui | — |
| `host_leg_minor` | `bigint` | oui | — |
| `insurer_leg_minor` | `bigint` | oui | — |
| `tax_third_party_leg_minor` | `bigint` | oui | — |
| `platform_leg_minor` | `bigint` | oui | — |
| `imputed_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `chargeback_imputation_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `chargeback_imputation_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `chargeback_imputation_earnings_valid` : `CHECK (earnings_kind = ANY (ARRAY['CANCELLATION'::text, 'REALIZED'::text]))`
- `chargeback_imputation_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `chargeback_imputation_segment_beta` : `CHECK (segment_no = 1)`
- `chargeback_imputation_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, settlement_version) REFERENCES core.settlement_settlement(id, trip_id, version)`
- `chargeback_imputation_shape` : `CHECK (lost_trip_minor > 0 AND collected_before_minor >= lost_trip_minor AND refund_committed_minor >= 0 AND owed_minor >= 0 AND host_from_guest_minor >= 0 AND host_paid_minor >= 0 AND retained_before_minor >= retained_after_minor AND retained_after_minor >= 0 AND host_payable_after_minor >= 0 AND clawback_minor >= 0 AND clawback_minor <= host_paid_minor AND host_unpaid_cancelled_minor >= 0 AND guest_receivable_minor >= 0 AND loss_expense_minor >= 0 AND (guest_receivable_minor + loss_expense_minor + clawback_minor + host_unpaid_cancelled_minor) = lost_trip_minor AND host_leg_minor = (- clawback_minor) AND insurer_leg_minor = 0 AND tax_third_party_leg_minor = 0 AND (host_leg_minor + insurer_leg_minor + tax_third_party_leg_minor + platform_leg_minor) = (- lost_trip_minor) AND (earnings_kind = 'CANCELLATION'::text OR clawback_minor = 0 AND host_unpaid_cancelled_minor = 0) AND (settlement_id IS NULL) = (settlement_version IS NULL) AND (earnings_kind <> 'CANCELLATION'::text OR settlement_id IS NOT NULL))`
- `chargeback_imputation_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `settlement_chargeback_imputation_pkey` : `PRIMARY KEY (operation_id)`

Index :

- `chargeback_imputation_trip_idx` : `CREATE INDEX chargeback_imputation_trip_idx ON core.settlement_chargeback_imputation USING btree (trip_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_chargeback_imputation FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_chargeback_imputation FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_finance_approval`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `action` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `requested_at` | `timestamp with time zone` | oui | `platform.now()` |
| `approved_by` | `uuid` | non | — |
| `approved_at` | `timestamp with time zone` | non | — |
| `status` | `text` | oui | — |

Contraintes :

- `finance_approval_action_valid` : `CHECK (action = ANY (ARRAY['DECIDE_ADVANCE'::text, 'WRITE_OFF_RECEIVABLE'::text, 'ISSUE_BORDEREAU'::text]))`
- `finance_approval_approved_at` : `CHECK ((approved_by IS NULL) = (approved_at IS NULL))`
- `finance_approval_approved_shape` : `CHECK ((status = 'APPROVED'::text) = (approved_by IS NOT NULL))`
- `finance_approval_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `finance_approval_reason_length` : `CHECK (char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 1000)`
- `finance_approval_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text]))`
- `finance_approval_two_people` : `CHECK (approved_by IS NULL OR approved_by <> requested_by)`
- `settlement_finance_approval_approved_by_fkey` : `FOREIGN KEY (approved_by) REFERENCES core.iam_user_account(id)`
- `settlement_finance_approval_pkey` : `PRIMARY KEY (id)`
- `settlement_finance_approval_requested_by_fkey` : `FOREIGN KEY (requested_by) REFERENCES core.iam_user_account(id)`

Index :

- `finance_approval_one_pending` : `CREATE UNIQUE INDEX finance_approval_one_pending ON core.settlement_finance_approval USING btree (action, subject_id) WHERE (status = 'PENDING'::text)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text) AND (approved_by IS NULL) AND (country_code = ANY (app.country_scope())))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (country_code = ANY (app.country_scope())))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `finance_approval_guard` : `CREATE TRIGGER finance_approval_guard BEFORE UPDATE ON core.settlement_finance_approval FOR EACH ROW EXECUTE FUNCTION core.settlement_finance_approval_guard()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_finance_approval FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_finance_approval FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`

### `core.settlement_host_ledger_entry`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `segment_no` | `integer` | non | — |
| `settlement_id` | `uuid` | non | — |
| `settlement_version` | `integer` | non | — |
| `reason` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `advance_id` | `uuid` | non | — |
| `chargeback_operation_id` | `uuid` | non | — |
| `payout_batch_id` | `uuid` | non | — |
| `write_off_approval_id` | `uuid` | non | — |
| `claim_decision_id` | `uuid` | non | — |

Contraintes :

- `host_ledger_advance_fk` : `FOREIGN KEY (advance_id) REFERENCES core.settlement_platform_advance(id)`
- `host_ledger_advance_shape` : `CHECK ((reason = 'RELEASED_LEG_ADVANCE'::text) = (advance_id IS NOT NULL) AND (reason <> 'RELEASED_LEG_ADVANCE'::text OR amount_minor < 0))`
- `host_ledger_advance_unique` : `UNIQUE (advance_id)`
- `host_ledger_amount_nonzero` : `CHECK (amount_minor <> 0)`
- `host_ledger_chargeback_fk` : `FOREIGN KEY (chargeback_operation_id) REFERENCES core.payment_payment_operation(id)`
- `host_ledger_claim_decision_fk` : `FOREIGN KEY (claim_decision_id) REFERENCES core.claim_decision(id)`
- `host_ledger_claim_decision_unique` : `UNIQUE (claim_decision_id)`
- `host_ledger_clawback_unique` : `UNIQUE (chargeback_operation_id)`
- `host_ledger_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `host_ledger_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `host_ledger_entry_settlement_reason_unique` : `UNIQUE NULLS NOT DISTINCT (settlement_id, reason, advance_id, chargeback_operation_id, payout_batch_id, write_off_approval_id, claim_decision_id)`
- `host_ledger_entry_version_reason_unique` : `UNIQUE NULLS NOT DISTINCT (trip_id, segment_no, settlement_version, reason, advance_id, chargeback_operation_id, payout_batch_id, write_off_approval_id, claim_decision_id)`
- `host_ledger_link_shape` : `CHECK ((reason = 'PAYOUT_NETTING'::text) = (payout_batch_id IS NOT NULL) AND (reason = 'CLAIM_HOST_DEDUCTIBLE'::text) = (claim_decision_id IS NOT NULL) AND (reason = ANY (ARRAY['PAYOUT_NETTING'::text, 'CLAIM_HOST_DEDUCTIBLE'::text])) = (settlement_id IS NULL) AND (settlement_id IS NULL) = (trip_id IS NULL) AND (settlement_id IS NULL) = (segment_no IS NULL) AND (settlement_id IS NULL) = (settlement_version IS NULL) AND (reason = 'CHARGEBACK_CLAWBACK'::text) = (chargeback_operation_id IS NOT NULL) AND (reason = 'RECEIVABLE_WRITE_OFF'::text) = (write_off_approval_id IS NOT NULL) AND ((reason <> ALL (ARRAY['CHARGEBACK_CLAWBACK'::text, 'CLAIM_HOST_DEDUCTIBLE'::text])) OR amount_minor < 0) AND ((reason <> ALL (ARRAY['PAYOUT_NETTING'::text, 'RECEIVABLE_WRITE_OFF'::text])) OR amount_minor > 0))`
- `host_ledger_netting_batch_fk` : `FOREIGN KEY (payout_batch_id, org_id, country_code, currency) REFERENCES core.payout_payout_batch(id, org_id, country_code, currency)`
- `host_ledger_netting_unique` : `UNIQUE (payout_batch_id)`
- `host_ledger_penalty_debit` : `CHECK (reason <> 'HOST_CANCELLATION_PENALTY'::text OR amount_minor < 0)`
- `host_ledger_reason_valid` : `CHECK (reason = ANY (ARRAY['HOST_CANCELLATION_PENALTY'::text, 'RELEASED_LEG_ADVANCE'::text, 'CHARGEBACK_CLAWBACK'::text, 'PAYOUT_NETTING'::text, 'RECEIVABLE_WRITE_OFF'::text, 'CLAIM_HOST_DEDUCTIBLE'::text]))`
- `host_ledger_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, segment_no, settlement_version, org_id, country_code, currency) REFERENCES core.settlement_settlement(id, trip_id, segment_no, version, org_id, country_code, currency)`
- `host_ledger_version_positive` : `CHECK (settlement_version >= 1)`
- `host_ledger_write_off_fk` : `FOREIGN KEY (write_off_approval_id) REFERENCES core.settlement_finance_approval(id)`
- `host_ledger_write_off_unique` : `UNIQUE (write_off_approval_id)`
- `settlement_host_ledger_entry_pkey` : `PRIMARY KEY (id)`

Index :

- `host_ledger_org_idx` : `CREATE INDEX host_ledger_org_idx ON core.settlement_host_ledger_entry USING btree (org_id, currency)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text) AND (reason = 'HOST_CANCELLATION_PENALTY'::text) AND (amount_minor < 0))`
- `cmd_money_ins_advance` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (reason = 'RELEASED_LEG_ADVANCE'::text) AND (amount_minor < 0) AND (advance_id IS NOT NULL))`
- `cmd_money_ins_claim_deductible` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (reason = 'CLAIM_HOST_DEDUCTIBLE'::text) AND (amount_minor < 0) AND (claim_decision_id IS NOT NULL))`
- `cmd_money_ins_clawback` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])) AND (reason = 'CHARGEBACK_CLAWBACK'::text) AND (amount_minor < 0) AND (chargeback_operation_id IS NOT NULL))`
- `cmd_money_ins_netting` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (reason = 'PAYOUT_NETTING'::text) AND (amount_minor > 0) AND (payout_batch_id IS NOT NULL))`
- `cmd_money_ins_write_off` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (reason = 'RECEIVABLE_WRITE_OFF'::text) AND (amount_minor > 0) AND (write_off_approval_id IS NOT NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `host_ledger_credit_guard` : `CREATE TRIGGER host_ledger_credit_guard BEFORE INSERT ON core.settlement_host_ledger_entry FOR EACH ROW WHEN (new.amount_minor > 0) EXECUTE FUNCTION core.settlement_host_ledger_credit_guard()`
- `host_ledger_state_projected` : `CREATE TRIGGER host_ledger_state_projected AFTER INSERT ON core.settlement_host_ledger_entry FOR EACH ROW EXECUTE FUNCTION core.settlement_host_ledger_state_projected()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_host_ledger_entry FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_host_ledger_entry FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_host_ledger_state`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `org_id` | `uuid` | oui | — |
| `currency` | `text` | oui | — |
| `country_code` | `text` | oui | — |
| `state` | `text` | oui | — |
| `balance_minor` | `bigint` | oui | — |
| `open_advances_minor` | `bigint` | oui | — |
| `since` | `timestamp with time zone` | oui | — |
| `next_action_at` | `timestamp with time zone` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `host_ledger_state_advances_nonneg` : `CHECK (open_advances_minor >= 0)`
- `host_ledger_state_balance_nonpositive` : `CHECK (balance_minor <= 0)`
- `host_ledger_state_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `host_ledger_state_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `host_ledger_state_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `host_ledger_state_shape` : `CHECK ((state = 'NEGATIVE'::text) = (balance_minor < 0) AND (state = 'NEGATIVE'::text) = (next_action_at IS NOT NULL))`
- `host_ledger_state_valid` : `CHECK (state = ANY (ARRAY['BALANCED'::text, 'NEGATIVE'::text, 'DIRECT_DEBIT'::text, 'PAYMENT_PLAN'::text, 'COLLECTIONS'::text, 'WRITTEN_OFF'::text]))`
- `settlement_host_ledger_state_pkey` : `PRIMARY KEY (org_id, currency)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `true` WITH CHECK `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_host_ledger_state FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_host_ledger_state FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`

### `core.settlement_insurer`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `country_code` | `text` | oui | — |
| `name` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `license_ref` | `text` | non | — |
| `status` | `text` | oui | `'ACTIVE'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `settlement_insurer_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `settlement_insurer_id_country_unique` : `UNIQUE (id, country_code)`
- `settlement_insurer_kind_valid` : `CHECK (kind = ANY (ARRAY['INSURER'::text, 'BROKER'::text]))`
- `settlement_insurer_license_format` : `CHECK (license_ref IS NULL OR license_ref ~ '^[A-Za-z0-9_.:/-]{1,64}$'::text)`
- `settlement_insurer_name_valid` : `CHECK (btrim(name) <> ''::text AND char_length(name) <= 160)`
- `settlement_insurer_pkey` : `PRIMARY KEY (id)`
- `settlement_insurer_status_valid` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text]))`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.settlement_insurer_bordereau`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `insurer_id` | `uuid` | oui | — |
| `insurer_contract_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `period` | `tstzrange` | oui | — |
| `total_minor` | `bigint` | oui | — |
| `status` | `text` | oui | `'DRAFT'::text` |
| `issued_by` | `uuid` | non | — |
| `second_validated_by` | `uuid` | non | — |
| `approval_id` | `uuid` | non | — |
| `issued_at` | `timestamp with time zone` | non | — |
| `paid_at` | `timestamp with time zone` | non | — |
| `psp_release_ref` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |
| `period_month` | `text` | non | — |

Contraintes :

- `insurer_bordereau_contract_fk` : `FOREIGN KEY (insurer_contract_id, insurer_id, country_code) REFERENCES core.settlement_insurer_contract(id, insurer_id, country_code)`
- `insurer_bordereau_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `insurer_bordereau_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `insurer_bordereau_id_country_unique` : `UNIQUE (id, country_code)`
- `insurer_bordereau_insurer_fk` : `FOREIGN KEY (insurer_id, country_code) REFERENCES core.settlement_insurer(id, country_code)`
- `insurer_bordereau_issue_pair` : `CHECK ((issued_by IS NULL) = (second_validated_by IS NULL) AND (issued_by IS NULL) = (approval_id IS NULL) AND (issued_by IS NULL) = (issued_at IS NULL) AND (issued_by IS NULL OR issued_by <> second_validated_by))`
- `insurer_bordereau_issued_shape` : `CHECK ((status = 'DRAFT'::text) = (issued_by IS NULL))`
- `insurer_bordereau_paid_shape` : `CHECK ((status = 'PAID'::text) = (paid_at IS NOT NULL))`
- `insurer_bordereau_period_month_format` : `CHECK (period_month IS NULL OR period_month ~ '^[0-9]{4}-(0[1-9]\|1[0-2])$'::text)`
- `insurer_bordereau_period_nonempty` : `CHECK (NOT isempty(period))`
- `insurer_bordereau_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'ISSUED'::text, 'PAID'::text, 'DISPUTED'::text]))`
- `insurer_bordereau_total_nonneg` : `CHECK (total_minor >= 0)`
- `settlement_insurer_bordereau_approval_id_fkey` : `FOREIGN KEY (approval_id) REFERENCES core.settlement_finance_approval(id)`
- `settlement_insurer_bordereau_issued_by_fkey` : `FOREIGN KEY (issued_by) REFERENCES core.iam_user_account(id)`
- `settlement_insurer_bordereau_pkey` : `PRIMARY KEY (id)`
- `settlement_insurer_bordereau_second_validated_by_fkey` : `FOREIGN KEY (second_validated_by) REFERENCES core.iam_user_account(id)`

Index :

- `insurer_bordereau_contract_month` : `CREATE UNIQUE INDEX insurer_bordereau_contract_month ON core.settlement_insurer_bordereau USING btree (insurer_contract_id, period_month) WHERE (period_month IS NOT NULL)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bordereau'::text) AND (status = 'DRAFT'::text) AND (period_month IS NOT NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = 'DRAFT'::text))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = 'ISSUED'::text))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `bordereau_transition_guard` : `CREATE TRIGGER bordereau_transition_guard BEFORE UPDATE ON core.settlement_insurer_bordereau FOR EACH ROW EXECUTE FUNCTION core.settlement_insurer_bordereau_guard()`
- `insurer_bordereau_issue_check` : `CREATE TRIGGER insurer_bordereau_issue_check BEFORE UPDATE OF status ON core.settlement_insurer_bordereau FOR EACH ROW WHEN (old.status = 'DRAFT'::text AND new.status = 'ISSUED'::text) EXECUTE FUNCTION core.settlement_insurer_bordereau_issue_check()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_bordereau FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_bordereau FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_insurer_bordereau FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.settlement_insurer_bordereau_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `bordereau_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `amount_minor` | `bigint` | oui | — |

Contraintes :

- `insurer_bordereau_line_amount_nonneg` : `CHECK (amount_minor >= 0)`
- `insurer_bordereau_line_bordereau_fk` : `FOREIGN KEY (bordereau_id, country_code) REFERENCES core.settlement_insurer_bordereau(id, country_code)`
- `insurer_bordereau_line_segment_beta` : `CHECK (segment_no = 1)`
- `insurer_bordereau_line_trip_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `insurer_bordereau_line_trip_once` : `UNIQUE (trip_id, segment_no)`
- `settlement_insurer_bordereau_line_pkey` : `PRIMARY KEY (bordereau_id, trip_id, segment_no)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bordereau'::text) AND (EXISTS ( SELECT 1 FROM core.settlement_insurer_bordereau b WHERE ((b.id = settlement_insurer_bordereau_line.bordereau_id) AND (b.country_code = settlement_insurer_bordereau_line.country_code) AND (b.status = 'DRAFT'::text)))))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_bordereau_line FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_bordereau_line FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE UPDATE ON core.settlement_insurer_bordereau_line FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_insurer_contract`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `insurer_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `version` | `integer` | oui | — |
| `vehicle_eligibility` | `jsonb` | oui | — |
| `signed_at` | `timestamp with time zone` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `valid_to` | `timestamp with time zone` | non | — |
| `document_file_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `broker_id` | `uuid` | non | — |
| `currency` | `text` | non | — |
| `rc_amount_minor` | `bigint` | non | — |
| `deductibles` | `jsonb` | non | — |
| `exclusions` | `jsonb` | non | — |
| `bordereau_period` | `text` | oui | `'MONTHLY'::text` |
| `chargeback_clause` | `text` | oui | `'PREMIUM_NEVER_REDUCED'::text` |

Contraintes :

- `settlement_insurer_contract_bordereau_period_valid` : `CHECK (bordereau_period = 'MONTHLY'::text)`
- `settlement_insurer_contract_broker_fk` : `FOREIGN KEY (broker_id, country_code) REFERENCES core.settlement_insurer(id, country_code)`
- `settlement_insurer_contract_chargeback_clause_valid` : `CHECK (chargeback_clause = 'PREMIUM_NEVER_REDUCED'::text)`
- `settlement_insurer_contract_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `settlement_insurer_contract_currency_format` : `CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'::text)`
- `settlement_insurer_contract_deductibles_shape` : `CHECK (deductibles IS NULL OR jsonb_typeof(deductibles) = 'object'::text AND deductibles ?& ARRAY['BASICA'::text, 'ESTANDAR'::text, 'TOTAL'::text] AND (deductibles - ARRAY['BASICA'::text, 'ESTANDAR'::text, 'TOTAL'::text]) = '{}'::jsonb AND jsonb_typeof(deductibles -> 'BASICA'::text) = 'string'::text AND jsonb_typeof(deductibles -> 'ESTANDAR'::text) = 'string'::text AND jsonb_typeof(deductibles -> 'TOTAL'::text) = 'string'::text AND (deductibles ->> 'BASICA'::text) ~ '^(0\|[1-9][0-9]{0,13})$'::text AND (deductibles ->> 'ESTANDAR'::text) ~ '^(0\|[1-9][0-9]{0,13})$'::text AND (deductibles ->> 'TOTAL'::text) ~ '^(0\|[1-9][0-9]{0,13})$'::text)`
- `settlement_insurer_contract_document_file_id_fkey` : `FOREIGN KEY (document_file_id) REFERENCES core.audit_file_asset(id)`
- `settlement_insurer_contract_eligibility_shape` : `CHECK (jsonb_typeof(vehicle_eligibility) = 'object'::text AND vehicle_eligibility ?& ARRAY['maxVehicleAgeYears'::text, 'usages'::text, 'valueClasses'::text] AND (vehicle_eligibility - ARRAY['maxVehicleAgeYears'::text, 'usages'::text, 'valueClasses'::text]) = '{}'::jsonb AND jsonb_typeof(vehicle_eligibility -> 'maxVehicleAgeYears'::text) = 'number'::text AND (vehicle_eligibility ->> 'maxVehicleAgeYears'::text) ~ '^[0-9]{1,2}$'::text AND jsonb_typeof(vehicle_eligibility -> 'valueClasses'::text) = 'array'::text AND jsonb_array_length(vehicle_eligibility -> 'valueClasses'::text) >= 1 AND (vehicle_eligibility -> 'valueClasses'::text) <@ '["STANDARD", "PREMIUM", "LUXE"]'::jsonb AND jsonb_typeof(vehicle_eligibility -> 'usages'::text) = 'array'::text AND jsonb_array_length(vehicle_eligibility -> 'usages'::text) >= 1 AND (vehicle_eligibility -> 'usages'::text) <@ '["PARTICULAR"]'::jsonb)`
- `settlement_insurer_contract_exclusions_shape` : `CHECK (exclusions IS NULL OR jsonb_typeof(exclusions) = 'object'::text AND exclusions ?& ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt-BR'::text] AND (exclusions - ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt-BR'::text]) = '{}'::jsonb AND jsonb_typeof(exclusions -> 'es'::text) = 'string'::text AND jsonb_typeof(exclusions -> 'en'::text) = 'string'::text AND jsonb_typeof(exclusions -> 'fr'::text) = 'string'::text AND jsonb_typeof(exclusions -> 'pt-BR'::text) = 'string'::text AND btrim(exclusions ->> 'es'::text) <> ''::text AND btrim(exclusions ->> 'en'::text) <> ''::text AND btrim(exclusions ->> 'fr'::text) <> ''::text AND btrim(exclusions ->> 'pt-BR'::text) <> ''::text AND char_length(exclusions ->> 'es'::text) <= 2000 AND char_length(exclusions ->> 'en'::text) <= 2000 AND char_length(exclusions ->> 'fr'::text) <= 2000 AND char_length(exclusions ->> 'pt-BR'::text) <= 2000)`
- `settlement_insurer_contract_insurer_fk` : `FOREIGN KEY (insurer_id, country_code) REFERENCES core.settlement_insurer(id, country_code)`
- `settlement_insurer_contract_no_overlap` : `EXCLUDE USING gist (country_code WITH =, tstzrange(valid_from, valid_to, '[)'::text) WITH &&)`
- `settlement_insurer_contract_period` : `CHECK (valid_to IS NULL OR valid_to > valid_from)`
- `settlement_insurer_contract_pkey` : `PRIMARY KEY (id)`
- `settlement_insurer_contract_rc_positive` : `CHECK (rc_amount_minor IS NULL OR rc_amount_minor > 0 AND rc_amount_minor <= '100000000000000'::bigint)`
- `settlement_insurer_contract_scope_unique` : `UNIQUE (id, insurer_id, country_code)`
- `settlement_insurer_contract_signed` : `CHECK (signed_at <= valid_from)`
- `settlement_insurer_contract_terms_complete` : `CHECK ((currency IS NULL) = (rc_amount_minor IS NULL) AND (currency IS NULL) = (deductibles IS NULL) AND (currency IS NULL) = (exclusions IS NULL))`
- `settlement_insurer_contract_version_positive` : `CHECK (version >= 1)`
- `settlement_insurer_contract_version_unique` : `UNIQUE (country_code, version)`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `true`
- `cmd_hold_contract_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `settlement_insurer_contract_terms_guard` : `CREATE TRIGGER settlement_insurer_contract_terms_guard BEFORE INSERT OR DELETE OR UPDATE ON core.settlement_insurer_contract FOR EACH ROW EXECUTE FUNCTION core.settlement_insurer_contract_terms_guard()`

### `core.settlement_insurer_ledger_entry`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `insurer_id` | `uuid` | non | — |
| `insurer_contract_id` | `uuid` | non | — |
| `reason` | `text` | oui | — |
| `operation_id` | `uuid` | non | — |
| `settlement_id` | `uuid` | non | — |
| `settlement_version` | `integer` | non | — |
| `amount_minor` | `bigint` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `insurer_ledger_entry_amount_nonzero` : `CHECK (amount_minor <> 0)`
- `insurer_ledger_entry_attribution` : `CHECK ((insurer_id IS NULL) = (insurer_contract_id IS NULL))`
- `insurer_ledger_entry_contract_fk` : `FOREIGN KEY (insurer_contract_id, insurer_id, country_code) REFERENCES core.settlement_insurer_contract(id, insurer_id, country_code)`
- `insurer_ledger_entry_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `insurer_ledger_entry_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `insurer_ledger_entry_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.settlement_leg_movement(operation_id)`
- `insurer_ledger_entry_operation_unique` : `UNIQUE (operation_id)`
- `insurer_ledger_entry_reason_valid` : `CHECK (reason = ANY (ARRAY['COLLECTION'::text, 'SETTLEMENT_VARIATION'::text]))`
- `insurer_ledger_entry_segment_beta` : `CHECK (segment_no = 1)`
- `insurer_ledger_entry_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, segment_no, settlement_version, org_id, country_code, currency) REFERENCES core.settlement_settlement(id, trip_id, segment_no, version, org_id, country_code, currency)`
- `insurer_ledger_entry_settlement_unique` : `UNIQUE (settlement_id)`
- `insurer_ledger_entry_source_shape` : `CHECK (reason = 'COLLECTION'::text AND operation_id IS NOT NULL AND settlement_id IS NULL AND settlement_version IS NULL AND amount_minor > 0 OR reason = 'SETTLEMENT_VARIATION'::text AND operation_id IS NULL AND settlement_id IS NOT NULL AND settlement_version IS NOT NULL)`
- `insurer_ledger_entry_trip_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `insurer_ledger_entry_version_positive` : `CHECK (settlement_version >= 1)`
- `settlement_insurer_ledger_entry_pkey` : `PRIMARY KEY (id)`

Index :

- `insurer_ledger_entry_contract_idx` : `CREATE INDEX insurer_ledger_entry_contract_idx ON core.settlement_insurer_ledger_entry USING btree (insurer_contract_id, country_code, currency) WHERE (insurer_contract_id IS NOT NULL)`
- `insurer_ledger_entry_trip_idx` : `CREATE INDEX insurer_ledger_entry_trip_idx ON core.settlement_insurer_ledger_entry USING btree (trip_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `(((reason = 'COLLECTION'::text) AND (EXISTS ( SELECT 1 FROM (core.settlement_leg_movement m JOIN core.payment_payment_operation_leg g ON (((g.operation_id = m.operation_id) AND (g.leg = 'INSURER'::text)))) WHERE ((m.operation_id = settlement_insurer_ledger_entry.operation_id) AND (m.trip_id = settlement_insurer_ledger_entry.trip_id) AND (m.segment_no = settlement_insurer_ledger_entry.segment_no) AND (m.kind = ANY (ARRAY['CAPTURE'::text, 'MIT_CHARGE'::text, 'DEBT_COLLECTION'::text])) AND (g.amount_minor = settlement_insurer_ledger_entry.amount_minor))))) OR ((reason = 'SETTLEMENT_VARIATION'::text) AND (EXISTS ( SELECT 1 FROM core.settlement_settlement_leg l WHERE ((l.settlement_id = settlement_insurer_ledger_entry.settlement_id) AND (l.leg = 'INSURER'::text) AND (l.trip_id = settlement_insurer_ledger_entry.trip_id) AND (l.segment_no = settlement_insurer_ledger_entry.segment_no) AND (l.variation_minor = settlement_insurer_ledger_entry.amount_minor))))))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_insurer_ledger_entry FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_insurer_ledger_entry FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_insurer_ledger_state`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `insurer_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `payable_minor` | `bigint` | oui | `0` |
| `frozen_minor` | `bigint` | oui | `0` |
| `receivable_minor` | `bigint` | oui | `0` |
| `next_bordereau_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `insurer_ledger_amounts_nonneg` : `CHECK (payable_minor >= 0 AND frozen_minor >= 0 AND receivable_minor >= 0)`
- `insurer_ledger_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `insurer_ledger_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `insurer_ledger_insurer_fk` : `FOREIGN KEY (insurer_id, country_code) REFERENCES core.settlement_insurer(id, country_code)`
- `settlement_insurer_ledger_state_pkey` : `PRIMARY KEY (insurer_id, country_code, currency)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'bordereau'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'bordereau'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'bordereau'::text])))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_ledger_state FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_ledger_state FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_insurer_ledger_state FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.settlement_leg_movement`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `applied_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `leg_movement_kind_valid` : `CHECK (kind = ANY (ARRAY['CAPTURE'::text, 'MIT_CHARGE'::text, 'DEBT_COLLECTION'::text, 'REFUND'::text, 'LEG_REALLOCATION'::text, 'LEG_RELEASE'::text]))`
- `leg_movement_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `leg_movement_segment_beta` : `CHECK (segment_no = 1)`
- `leg_movement_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `settlement_leg_movement_pkey` : `PRIMARY KEY (operation_id)`

Index :

- `leg_movement_trip_idx` : `CREATE INDEX leg_movement_trip_idx ON core.settlement_leg_movement USING btree (trip_id)`

Politiques RLS :

- `cmd_money_conversion_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (kind = 'CAPTURE'::text) AND (segment_no = 1) AND (EXISTS ( SELECT 1 FROM (core.booking_payment_disposition d JOIN core.payment_payment_operation o ON ((o.id = d.operation_id))) WHERE ((d.operation_id = settlement_leg_movement.operation_id) AND (d.trip_id = settlement_leg_movement.trip_id) AND (d.disposition = 'CONVERSION'::text) AND (o.trip_id = settlement_leg_movement.trip_id) AND (o.kind = 'CAPTURE'::text) AND (o.status = 'SUCCEEDED'::text) AND (o.proof_type IS NOT NULL)))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `insurer_ledger_collection_posted` : `CREATE TRIGGER insurer_ledger_collection_posted AFTER INSERT ON core.settlement_leg_movement FOR EACH ROW WHEN (new.kind = ANY (ARRAY['CAPTURE'::text, 'MIT_CHARGE'::text, 'DEBT_COLLECTION'::text])) EXECUTE FUNCTION core.settlement_post_insurer_collection()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_leg_movement FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_leg_movement FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_platform_advance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `org_id` | `uuid` | non | — |
| `insurer_id` | `uuid` | non | — |
| `cause` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `funded_from` | `text` | oui | — |
| `receivable_minor` | `bigint` | oui | `0` |
| `recovered_minor` | `bigint` | oui | `0` |
| `status` | `text` | oui | `'OPEN'::text` |
| `decided_by` | `uuid` | non | — |
| `decision_second_by` | `uuid` | non | — |
| `decision_approval_id` | `uuid` | non | — |
| `written_off_at` | `timestamp with time zone` | non | — |
| `written_off_by` | `uuid` | non | — |
| `write_off_second_by` | `uuid` | non | — |
| `write_off_approval_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `platform_advance_amount_positive` : `CHECK (amount_minor > 0)`
- `platform_advance_amounts` : `CHECK (receivable_minor >= 0 AND recovered_minor >= 0 AND recovered_minor <= receivable_minor AND receivable_minor <= amount_minor)`
- `platform_advance_cause_valid` : `CHECK (cause = ANY (ARRAY['RELEASED_LEG'::text, 'CREDIT_BEYOND_PLATFORM'::text, 'CHARGEBACK_LOSS'::text, 'HOST_COMPENSATION'::text]))`
- `platform_advance_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `platform_advance_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `platform_advance_decision_pair` : `CHECK ((decided_by IS NULL) = (decision_second_by IS NULL) AND (decided_by IS NULL) = (decision_approval_id IS NULL) AND (decided_by IS NULL OR decided_by <> decision_second_by))`
- `platform_advance_funded_from_valid` : `CHECK (funded_from = ANY (ARRAY['TRIP_PLATFORM_LEG'::text, 'COUNTRY_PLATFORM_BALANCE'::text]))`
- `platform_advance_insurer_fk` : `FOREIGN KEY (insurer_id, country_code) REFERENCES core.settlement_insurer(id, country_code)`
- `platform_advance_no_receivable` : `CHECK ((cause <> ALL (ARRAY['CREDIT_BEYOND_PLATFORM'::text, 'CHARGEBACK_LOSS'::text])) OR receivable_minor = 0)`
- `platform_advance_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `platform_advance_recovered_shape` : `CHECK (status <> 'RECOVERED'::text OR recovered_minor = receivable_minor)`
- `platform_advance_released_leg` : `CHECK (cause <> 'RELEASED_LEG'::text OR receivable_minor = amount_minor AND (org_id IS NOT NULL OR insurer_id IS NOT NULL))`
- `platform_advance_status_valid` : `CHECK (status = ANY (ARRAY['PLANNED'::text, 'OPEN'::text, 'RECOVERING'::text, 'RECOVERED'::text, 'WRITTEN_OFF'::text, 'CANCELLED'::text]))`
- `platform_advance_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `platform_advance_write_off_pair` : `CHECK ((written_off_by IS NULL) = (write_off_second_by IS NULL) AND (written_off_by IS NULL) = (write_off_approval_id IS NULL) AND (written_off_by IS NULL) = (written_off_at IS NULL) AND (written_off_by IS NULL OR written_off_by <> write_off_second_by))`
- `platform_advance_written_off_shape` : `CHECK ((status = 'WRITTEN_OFF'::text) = (written_off_by IS NOT NULL))`
- `settlement_platform_advance_decided_by_fkey` : `FOREIGN KEY (decided_by) REFERENCES core.iam_user_account(id)`
- `settlement_platform_advance_decision_approval_id_fkey` : `FOREIGN KEY (decision_approval_id) REFERENCES core.settlement_finance_approval(id)`
- `settlement_platform_advance_decision_second_by_fkey` : `FOREIGN KEY (decision_second_by) REFERENCES core.iam_user_account(id)`
- `settlement_platform_advance_pkey` : `PRIMARY KEY (id)`
- `settlement_platform_advance_write_off_approval_id_fkey` : `FOREIGN KEY (write_off_approval_id) REFERENCES core.settlement_finance_approval(id)`
- `settlement_platform_advance_write_off_second_by_fkey` : `FOREIGN KEY (write_off_second_by) REFERENCES core.iam_user_account(id)`
- `settlement_platform_advance_written_off_by_fkey` : `FOREIGN KEY (written_off_by) REFERENCES core.iam_user_account(id)`

Index :

- `platform_advance_org_idx` : `CREATE INDEX platform_advance_org_idx ON core.settlement_platform_advance USING btree (org_id) WHERE (cause = 'RELEASED_LEG'::text)`
- `platform_advance_trip_idx` : `CREATE INDEX platform_advance_trip_idx ON core.settlement_platform_advance USING btree (trip_id)`

Politiques RLS :

- `advance_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (cause = 'RELEASED_LEG'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `cmd_advance_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `(((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payout'::text, 'payment_command'::text])) AND (status = ANY (ARRAY['PLANNED'::text, 'OPEN'::text, 'RECOVERING'::text]))) OR ((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = ANY (ARRAY['PLANNED'::text, 'OPEN'::text, 'RECOVERING'::text]))))` WITH CHECK `(((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payout'::text, 'payment_command'::text])) AND (status = ANY (ARRAY['PLANNED'::text, 'OPEN'::text, 'RECOVERING'::text, 'RECOVERED'::text, 'CANCELLED'::text])) AND (written_off_by IS NULL)) OR ((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = ANY (ARRAY['PLANNED'::text, 'OPEN'::text, 'RECOVERING'::text, 'WRITTEN_OFF'::text]))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payout'::text, 'payment_command'::text])) AND (recovered_minor = 0) AND (decided_by IS NULL) AND (written_off_by IS NULL) AND ((status = 'PLANNED'::text) OR ((status = 'OPEN'::text) AND (cause <> 'RELEASED_LEG'::text))))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `advance_ledger_projected` : `CREATE TRIGGER advance_ledger_projected AFTER INSERT OR UPDATE OF status, recovered_minor ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION core.settlement_advance_ledger_projected()`
- `advance_transition_guard` : `CREATE TRIGGER advance_transition_guard BEFORE UPDATE ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION core.settlement_platform_advance_guard()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_platform_advance FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `platform_advance_receivable_posted` : `CREATE TRIGGER platform_advance_receivable_posted AFTER UPDATE OF status ON core.settlement_platform_advance FOR EACH ROW WHEN (old.status = 'PLANNED'::text AND new.status = 'OPEN'::text AND new.cause = 'RELEASED_LEG'::text) EXECUTE FUNCTION core.settlement_post_advance_receivable()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.settlement_settlement`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `version` | `integer` | oui | — |
| `supersedes_id` | `uuid` | non | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `engine_version` | `text` | oui | — |
| `requested_reason` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `origin` | `text` | oui | — |
| `qualification` | `text` | oui | — |
| `target_state` | `text` | oui | — |
| `host_eligible` | `boolean` | oui | — |
| `total_paid_minor` | `bigint` | oui | — |
| `guest_refund_minor` | `bigint` | oui | — |
| `tax_refund_minor` | `bigint` | oui | — |
| `retained_minor` | `bigint` | oui | — |
| `retained_tax_minor` | `bigint` | oui | — |
| `host_from_guest_minor` | `bigint` | oui | — |
| `host_compensation_minor` | `bigint` | oui | — |
| `host_earnings_minor` | `bigint` | oui | — |
| `platform_net_minor` | `bigint` | oui | — |
| `host_penalty_minor` | `bigint` | oui | — |
| `negative_leg` | `boolean` | oui | — |
| `inputs` | `text` | oui | — |
| `inputs_hash` | `bytea` | oui | — |
| `param_snapshot_hash` | `bytea` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `settlement_amounts_nonneg` : `CHECK (total_paid_minor >= 0 AND guest_refund_minor >= 0 AND tax_refund_minor >= 0 AND retained_tax_minor >= 0 AND (retained_minor + retained_tax_minor) >= 0 AND host_from_guest_minor >= 0 AND host_compensation_minor >= 0 AND host_penalty_minor >= 0)`
- `settlement_balance` : `CHECK ((guest_refund_minor + retained_minor + retained_tax_minor) = total_paid_minor)`
- `settlement_balanced` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `settlement_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `settlement_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `settlement_earnings` : `CHECK (host_earnings_minor = (host_from_guest_minor + host_compensation_minor))`
- `settlement_engine_version_format` : `CHECK (engine_version ~ '^[a-z][a-z0-9-]{0,30}/[0-9]{1,6}$'::text)`
- `settlement_id_trip_version_unique` : `UNIQUE (id, trip_id, version)`
- `settlement_inputs_engine` : `CHECK ((inputs::jsonb ->> 'engineVersion'::text) = engine_version)`
- `settlement_inputs_hash_match` : `CHECK (sha256(convert_to(('rueda.settlement.inputs/1'::text \|\| chr(10)) \|\| inputs, 'UTF8'::name)) = inputs_hash)`
- `settlement_inputs_hash_sha256` : `CHECK (octet_length(inputs_hash) = 32)`
- `settlement_kind_valid` : `CHECK (kind = ANY (ARRAY['CANCELLATION'::text, 'TERMINATION'::text, 'COMPLETION'::text]))`
- `settlement_ledger_scope_unique` : `UNIQUE (id, trip_id, segment_no, version, org_id, country_code, currency)`
- `settlement_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `settlement_origin_format` : `CHECK (origin ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_param_hash_sha256` : `CHECK (octet_length(param_snapshot_hash) = 32)`
- `settlement_platform_net` : `CHECK (platform_net_minor = (retained_minor - host_earnings_minor))`
- `settlement_qualification_valid` : `CHECK (qualification = ANY (ARRAY['VOLUNTARY'::text, 'FAULT_PRE_START'::text, 'NO_SHOW'::text, 'FULL'::text]))`
- `settlement_reason_format` : `CHECK (reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_requested_reason_format` : `CHECK (requested_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_scope_unique` : `UNIQUE (id, trip_id, segment_no, org_id, country_code)`
- `settlement_segment_beta` : `CHECK (segment_no = 1)`
- `settlement_segment_unique` : `UNIQUE (id, trip_id, segment_no)`
- `settlement_settlement_pkey` : `PRIMARY KEY (id)`
- `settlement_supersedes_fk` : `FOREIGN KEY (supersedes_id, trip_id, segment_no) REFERENCES core.settlement_settlement(id, trip_id, segment_no)`
- `settlement_supersedes_unique` : `UNIQUE (supersedes_id)`
- `settlement_supersession_shape` : `CHECK ((version = 1) = (supersedes_id IS NULL))`
- `settlement_target_state_format` : `CHECK (target_state ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `settlement_version_positive` : `CHECK (version >= 1)`
- `settlement_version_unique` : `UNIQUE (trip_id, segment_no, version)`

Index :

- `settlement_org_idx` : `CREATE INDEX settlement_org_idx ON core.settlement_settlement USING btree (org_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `refund_instance_supersede` : `CREATE TRIGGER refund_instance_supersede AFTER INSERT ON core.settlement_settlement FOR EACH ROW WHEN (new.supersedes_id IS NOT NULL) EXECUTE FUNCTION core.payment_refund_instance_supersede()`
- `settlement_balanced` : `CREATE CONSTRAINT TRIGGER settlement_balanced AFTER INSERT ON core.settlement_settlement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.settlement_assert_balanced()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_settlement_leg`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `settlement_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `leg` | `text` | oui | — |
| `kept_minor` | `bigint` | oui | — |
| `advance_minor` | `bigint` | oui | — |
| `basis_minor` | `bigint` | oui | — |
| `variation_minor` | `bigint` | oui | — |

Contraintes :

- `settlement_leg_advance_nonneg` : `CHECK (advance_minor >= 0)`
- `settlement_leg_advance_platform` : `CHECK (advance_minor = 0 OR leg = 'PLATFORM'::text AND kept_minor = 0)`
- `settlement_leg_kept_nonneg` : `CHECK (kept_minor >= 0)`
- `settlement_leg_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, segment_no, org_id, country_code) REFERENCES core.settlement_settlement(id, trip_id, segment_no, org_id, country_code)`
- `settlement_leg_valid` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `settlement_leg_variation` : `CHECK (variation_minor = (kept_minor - advance_minor - basis_minor))`
- `settlement_settlement_leg_pkey` : `PRIMARY KEY (settlement_id, leg)`

Index :

- `settlement_leg_org_idx` : `CREATE INDEX settlement_leg_org_idx ON core.settlement_settlement_leg USING btree (org_id) WHERE (leg = 'HOST'::text)`
- `settlement_leg_trip_idx` : `CREATE INDEX settlement_leg_trip_idx ON core.settlement_settlement_leg USING btree (trip_id, segment_no)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_leg_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (leg = 'HOST'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `settlement_leg_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR app.staff_case_covers('TRIP'::text, trip_id)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `insurer_ledger_variation_posted` : `CREATE TRIGGER insurer_ledger_variation_posted AFTER INSERT ON core.settlement_settlement_leg FOR EACH ROW WHEN (new.leg = 'INSURER'::text AND new.variation_minor <> 0) EXECUTE FUNCTION core.settlement_post_insurer_variation()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement_leg FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_leg FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_settlement_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `settlement_id` | `uuid` | oui | — |
| `line_type` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `refund_minor` | `bigint` | oui | — |
| `retained_minor` | `bigint` | oui | — |

Contraintes :

- `settlement_line_split` : `CHECK ((refund_minor + retained_minor) = amount_minor)`
- `settlement_line_type_format` : `CHECK (line_type ~ '^[a-z][A-Za-z]{0,62}$'::text)`
- `settlement_settlement_line_pkey` : `PRIMARY KEY (settlement_id, line_type)`
- `settlement_settlement_line_settlement_id_fkey` : `FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement(id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_line_read` (SELECT, PERMISSIVE, app_api) USING `(EXISTS ( SELECT 1 FROM core.settlement_settlement s WHERE (s.id = settlement_settlement_line.settlement_id)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement_line FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_line FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_settlement_tax_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `settlement_id` | `uuid` | oui | — |
| `tax_group` | `text` | oui | — |
| `third_party` | `boolean` | oui | — |
| `tax_paid_minor` | `bigint` | oui | — |
| `tax_refund_minor` | `bigint` | oui | — |
| `retained_tax_minor` | `bigint` | oui | — |

Contraintes :

- `settlement_settlement_tax_line_pkey` : `PRIMARY KEY (settlement_id, tax_group)`
- `settlement_settlement_tax_line_settlement_id_fkey` : `FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement(id)`
- `settlement_tax_group_format` : `CHECK (tax_group ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$'::text)`
- `settlement_tax_line_nonneg` : `CHECK (tax_paid_minor >= 0 AND tax_refund_minor >= 0 AND retained_tax_minor >= 0)`
- `settlement_tax_line_split` : `CHECK ((tax_refund_minor + retained_tax_minor) = tax_paid_minor)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_tax_line_read` (SELECT, PERMISSIVE, app_api) USING `(EXISTS ( SELECT 1 FROM core.settlement_settlement s WHERE (s.id = settlement_settlement_tax_line.settlement_id)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement_tax_line FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_tax_line FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_trip_leg_balance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `leg` | `text` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `captured_minor` | `bigint` | oui | `0` |
| `refunded_minor` | `bigint` | oui | `0` |
| `reallocated_in_minor` | `bigint` | oui | `0` |
| `reallocated_out_minor` | `bigint` | oui | `0` |
| `released_minor` | `bigint` | oui | `0` |
| `frozen` | `boolean` | oui | `false` |
| `frozen_reason` | `text` | non | — |
| `release_at` | `timestamp with time zone` | non | — |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `settlement_trip_leg_balance_pkey` : `PRIMARY KEY (trip_id, segment_no, leg)`
- `trip_leg_balance_amounts_nonneg` : `CHECK (captured_minor >= 0 AND refunded_minor >= 0 AND reallocated_in_minor >= 0 AND reallocated_out_minor >= 0 AND released_minor >= 0)`
- `trip_leg_balance_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `trip_leg_balance_frozen_reason_valid` : `CHECK (frozen_reason = ANY (ARRAY['CHARGEBACK'::text, 'DISPUTE'::text, 'CLAIM'::text]))`
- `trip_leg_balance_frozen_shape` : `CHECK (frozen = (frozen_reason IS NOT NULL))`
- `trip_leg_balance_leg_valid` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `trip_leg_balance_nonneg` : `CHECK ((captured_minor + reallocated_in_minor - refunded_minor - reallocated_out_minor - released_minor) >= 0)`
- `trip_leg_balance_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `trip_leg_balance_segment_beta` : `CHECK (segment_no = 1)`
- `trip_leg_balance_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`

Index :

- `trip_leg_balance_org_idx` : `CREATE INDEX trip_leg_balance_org_idx ON core.settlement_trip_leg_balance USING btree (org_id) WHERE (leg = 'HOST'::text)`

Politiques RLS :

- `cmd_money_chargeback_freeze` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((leg = ANY (ARRAY['HOST'::text, 'INSURER'::text])) AND (NOT frozen))` WITH CHECK `((leg = ANY (ARRAY['HOST'::text, 'INSURER'::text])) AND frozen AND (frozen_reason = 'CHARGEBACK'::text) AND (EXISTS ( SELECT 1 FROM core.payment_payment_operation o WHERE ((o.trip_id = settlement_trip_leg_balance.trip_id) AND (o.kind = 'CHARGEBACK'::text) AND (o.status <> 'FAILED'::text)))))`
- `cmd_money_chargeback_unfreeze` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((leg = ANY (ARRAY['HOST'::text, 'INSURER'::text])) AND frozen AND (frozen_reason = 'CHARGEBACK'::text))` WITH CHECK `((leg = ANY (ARRAY['HOST'::text, 'INSURER'::text])) AND (NOT frozen) AND (frozen_reason IS NULL))`
- `cmd_money_conversion_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (captured_minor = 0) AND (refunded_minor = 0) AND (reallocated_in_minor = 0) AND (reallocated_out_minor = 0) AND (released_minor = 0) AND (NOT frozen) AND (EXISTS ( SELECT 1 FROM core.booking_payment_disposition d WHERE ((d.trip_id = settlement_trip_leg_balance.trip_id) AND (d.disposition = 'CONVERSION'::text)))))`
- `cmd_money_conversion_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (captured_minor = 0) AND (refunded_minor = 0) AND (reallocated_in_minor = 0) AND (reallocated_out_minor = 0) AND (released_minor = 0) AND (NOT frozen) AND (EXISTS ( SELECT 1 FROM core.booking_payment_disposition d WHERE ((d.trip_id = settlement_trip_leg_balance.trip_id) AND (d.disposition = 'CONVERSION'::text)))))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (refunded_minor = 0) AND (reallocated_in_minor = 0) AND (reallocated_out_minor = 0) AND (released_minor = 0) AND (NOT frozen) AND (captured_minor = ( SELECT g.amount_minor FROM (core.booking_payment_disposition d JOIN core.payment_payment_operation_leg g ON ((g.operation_id = d.operation_id))) WHERE ((d.trip_id = settlement_trip_leg_balance.trip_id) AND (d.disposition = 'CONVERSION'::text) AND (g.leg = settlement_trip_leg_balance.leg)))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (captured_minor = 0) AND (refunded_minor = 0) AND (reallocated_in_minor = 0) AND (reallocated_out_minor = 0) AND (released_minor = 0) AND (NOT frozen))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `leg_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (leg = 'HOST'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `leg_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR app.staff_case_covers('TRIP'::text, trip_id)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_trip_leg_balance FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`
- `trip_leg_balance_guard` : `CREATE TRIGGER trip_leg_balance_guard BEFORE DELETE OR UPDATE ON core.settlement_trip_leg_balance FOR EACH ROW EXECUTE FUNCTION core.settlement_trip_leg_balance_guard()`
- `trip_leg_balance_no_truncate` : `CREATE TRIGGER trip_leg_balance_no_truncate BEFORE TRUNCATE ON core.settlement_trip_leg_balance FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`
- `trip_leg_balance_release_at_guard` : `CREATE TRIGGER trip_leg_balance_release_at_guard BEFORE UPDATE OF release_at ON core.settlement_trip_leg_balance FOR EACH ROW EXECUTE FUNCTION core.settlement_release_at_guard()`

### `core.support_internal_note`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `author_user_id` | `uuid` | oui | — |
| `author_role` | `text` | oui | — |
| `body` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `internal_note_author_role_format` : `CHECK (author_role ~ '^[A-Z][A-Z_]{1,63}$'::text)`
- `internal_note_body_length` : `CHECK (char_length(btrim(body)) >= 1 AND char_length(btrim(body)) <= 2000)`
- `internal_note_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `internal_note_pkey` : `PRIMARY KEY (id)`
- `internal_note_subject_type_valid` : `CHECK (subject_type = 'USER_ACCOUNT'::text)`
- `support_internal_note_author_user_id_fkey` : `FOREIGN KEY (author_user_id) REFERENCES core.iam_user_account(id)`

Index :

- `internal_note_subject_idx` : `CREATE INDEX internal_note_subject_idx ON core.support_internal_note USING btree (subject_type, subject_id, created_at)`

Politiques RLS :

- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `internal_note_append_only` : `CREATE TRIGGER internal_note_append_only BEFORE DELETE OR UPDATE ON core.support_internal_note FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('internal_note_append_only')`
- `internal_note_no_truncate` : `CREATE TRIGGER internal_note_no_truncate BEFORE TRUNCATE ON core.support_internal_note FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('internal_note_append_only')`

### `core.support_manual_action`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `action_code` | `text` | oui | — |
| `mode` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `actor_user_id` | `uuid` | oui | — |
| `actor_role` | `text` | oui | — |
| `input` | `jsonb` | oui | `'{}'::jsonb` |
| `evidence_file_ids` | `uuid[]` | oui | `'{}'::uuid[]` |
| `reason` | `text` | oui | — |
| `emitted_event_ids` | `uuid[]` | oui | `'{}'::uuid[]` |
| `audit_log_id` | `bigint` | non | — |
| `request_id` | `uuid` | oui | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |
| `outcome` | `text` | non | — |
| `domain_ref` | `uuid` | non | — |

Contraintes :

- `manual_action_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `manual_action_evidence_bounded` : `CHECK (cardinality(evidence_file_ids) <= 20)`
- `manual_action_idempotent` : `UNIQUE (action_code, subject_id, request_id)`
- `manual_action_input_object` : `CHECK (jsonb_typeof(input) = 'object'::text)`
- `manual_action_mode_valid` : `CHECK (mode = ANY (ARRAY['DOMAIN_COMMAND'::text, 'RECORD_ONLY'::text]))`
- `manual_action_outcome_valid` : `CHECK (outcome = ANY (ARRAY['RECORDED'::text, 'DONE'::text, 'REQUESTED'::text]))`
- `manual_action_pkey` : `PRIMARY KEY (id)`
- `manual_action_reason_length` : `CHECK (char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 1000)`
- `support_manual_action_action_code_fkey` : `FOREIGN KEY (action_code) REFERENCES core.support_manual_action_catalog(action_code)`
- `support_manual_action_actor_user_id_fkey` : `FOREIGN KEY (actor_user_id) REFERENCES core.iam_user_account(id)`
- `support_manual_action_audit_log_id_fkey` : `FOREIGN KEY (audit_log_id) REFERENCES core.audit_audit_log(id)`

Politiques RLS :

- `cmd_hold_cancel_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(action_code = ANY (ARRAY['CANCEL_TRIP_GUEST'::text, 'CANCEL_TRIP_HOST'::text, 'CANCEL_TRIP_PLATFORM'::text, 'DECLARE_NO_SHOW'::text, 'REFUSE_AT_PICKUP'::text]))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(audit_log_id IS NULL)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(audit_log_id IS NULL)` WITH CHECK `(audit_log_id IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `((subject_type = 'TRIP'::text) AND (action_code = ANY (ARRAY['RECORD_CHARGEBACK'::text, 'OPEN_INCIDENT'::text])))`

### `core.support_manual_action_catalog`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `action_code` | `text` | oui | — |
| `permission_code` | `text` | oui | — |
| `mode` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `available` | `boolean` | oui | — |
| `input_keys` | `text[]` | oui | `'{}'::text[]` |
| `input_values` | `jsonb` | oui | `'{}'::jsonb` |
| `requires_approval` | `boolean` | oui | `false` |

Contraintes :

- `manual_action_catalog_approval_domain` : `CHECK (NOT requires_approval OR mode = 'DOMAIN_COMMAND'::text)`
- `manual_action_catalog_code_format` : `CHECK (action_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `manual_action_catalog_input_keys_format` : `CHECK (cardinality(input_keys) <= 8 AND array_position(input_keys, NULL::text) IS NULL AND array_to_string(input_keys, ','::text) ~ '^([a-z][A-Za-z]{0,31}(,[a-z][A-Za-z]{0,31})*)?$'::text AND array_to_string(input_keys, ','::text) !~* '(amount\|minor\|montant\|monto\|valor\|price\|prix\|precio\|fee\|total\|refund\|sum)'::text)`
- `manual_action_catalog_input_values_valid` : `CHECK (core.support_input_values_valid(input_keys, input_values))`
- `manual_action_catalog_mode_valid` : `CHECK (mode = ANY (ARRAY['DOMAIN_COMMAND'::text, 'RECORD_ONLY'::text]))`
- `manual_action_catalog_permission_format` : `CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'::text)`
- `manual_action_catalog_pkey` : `PRIMARY KEY (action_code)`
- `manual_action_catalog_subject_valid` : `CHECK (subject_type = ANY (ARRAY['TRIP'::text, 'ORGANIZATION'::text, 'IDENTITY_VERIFICATION'::text, 'LISTING'::text, 'SUPPORT_CASE'::text, 'PLATFORM_ADVANCE'::text, 'INSURER_BORDEREAU'::text, 'USER_ACCOUNT'::text, 'RISK_ASSESSMENT'::text]))`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.support_manual_action_handler`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `action_code` | `text` | oui | — |
| `handler` | `regprocedure` | oui | — |
| `story` | `text` | oui | — |
| `bound_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `manual_action_handler_pkey` : `PRIMARY KEY (action_code)`
- `manual_action_handler_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`
- `support_manual_action_handler_action_code_fkey` : `FOREIGN KEY (action_code) REFERENCES core.support_manual_action_catalog(action_code)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `manual_action_handler_guard` : `CREATE TRIGGER manual_action_handler_guard BEFORE INSERT OR UPDATE ON core.support_manual_action_handler FOR EACH ROW EXECUTE FUNCTION core.support_manual_action_handler_guard()`

### `core.support_manual_action_subject`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `subject_type` | `text` | oui | — |
| `resolver` | `regprocedure` | oui | — |
| `story` | `text` | oui | — |
| `declared_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `manual_action_subject_pkey` : `PRIMARY KEY (subject_type)`
- `manual_action_subject_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`
- `manual_action_subject_type_format` : `CHECK (subject_type ~ '^[A-Z][A-Z_]{1,63}$'::text)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `manual_action_subject_guard` : `CREATE TRIGGER manual_action_subject_guard BEFORE INSERT OR UPDATE ON core.support_manual_action_subject FOR EACH ROW EXECUTE FUNCTION core.support_manual_action_subject_guard()`

### `core.support_review_queue`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `queue` | `text` | oui | — |
| `permission_code` | `text` | oui | — |
| `sla_param_key` | `text` | oui | — |
| `sla_unit_minutes` | `integer` | oui | — |
| `story` | `text` | oui | — |

Contraintes :

- `review_queue_permission_format` : `CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'::text)`
- `review_queue_pkey` : `PRIMARY KEY (queue)`
- `review_queue_queue_valid` : `CHECK (queue = ANY (ARRAY['KYC'::text, 'LISTING'::text, 'HOST_VERIFICATION'::text, 'RISK_BOOKING'::text, 'OVERDUE'::text, 'GRAY_MARKET'::text, 'CATALOG_ADDITION'::text, 'LEG_RECONCILIATION'::text]))`
- `review_queue_sla_param_format` : `CHECK (sla_param_key ~ '^[a-z][a-z0-9_]{1,63}$'::text)`
- `review_queue_sla_unit_valid` : `CHECK (sla_unit_minutes = ANY (ARRAY[1, 60]))`
- `review_queue_story_format` : `CHECK (story ~ '^US-[0-9]{3}$'::text)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.support_review_queue_item`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `queue` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | `'OPEN'::text` |
| `sla_due_at` | `timestamp with time zone` | oui | — |
| `assignee_id` | `uuid` | non | — |
| `assigned_at` | `timestamp with time zone` | non | — |
| `decision` | `text` | non | — |
| `decided_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `sla_breached_at` | `timestamp with time zone` | non | — |

Contraintes :

- `review_queue_item_assignment` : `CHECK ((assignee_id IS NULL) = (assigned_at IS NULL))`
- `review_queue_item_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `review_queue_item_decided` : `CHECK ((status = ANY (ARRAY['DONE'::text, 'CANCELLED'::text])) = (decided_at IS NOT NULL))`
- `review_queue_item_decision_format` : `CHECK (decision ~ '^[A-Z][A-Z_]{1,63}$'::text)`
- `review_queue_item_in_review_assigned` : `CHECK (status <> 'IN_REVIEW'::text OR assignee_id IS NOT NULL)`
- `review_queue_item_pkey` : `PRIMARY KEY (id)`
- `review_queue_item_queue_fk` : `FOREIGN KEY (queue) REFERENCES core.support_review_queue(queue)`
- `review_queue_item_sla_after_creation` : `CHECK (sla_due_at >= created_at)`
- `review_queue_item_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text, 'DONE'::text, 'CANCELLED'::text]))`
- `review_queue_item_subject_type_format` : `CHECK (subject_type ~ '^[A-Z][A-Z_]{1,63}$'::text)`
- `support_review_queue_item_assignee_id_fkey` : `FOREIGN KEY (assignee_id) REFERENCES core.iam_user_account(id)`

Index :

- `review_queue_item_live_unique` : `CREATE UNIQUE INDEX review_queue_item_live_unique ON core.support_review_queue_item USING btree (queue, subject_type, subject_id) WHERE (status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text]))`
- `review_queue_item_queue_due_idx` : `CREATE INDEX review_queue_item_queue_due_idx ON core.support_review_queue_item USING btree (queue, country_code, sla_due_at) WHERE (status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text]))`
- `review_queue_item_subject_idx` : `CREATE INDEX review_queue_item_subject_idx ON core.support_review_queue_item USING btree (subject_type, subject_id)`

Politiques RLS :

- `catalog_cmd_read` (SELECT, PERMISSIVE, catalog_cmd_owner) USING `(queue = ANY (ARRAY['CATALOG_ADDITION'::text, 'LISTING'::text]))`
- `cmd_hold_risk_queue` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(queue = 'RISK_BOOKING'::text)`
- `iam_staff_close` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text]))` WITH CHECK `((status = ANY (ARRAY['DONE'::text, 'CANCELLED'::text])) AND (decided_at IS NOT NULL))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(status = 'OPEN'::text)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text]))` WITH CHECK `(status = ANY (ARRAY['OPEN'::text, 'IN_REVIEW'::text]))`
- `kyc_cmd_host_queue_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(queue = 'HOST_VERIFICATION'::text)`
- `kyc_cmd_select` (SELECT, PERMISSIVE, kyc_cmd_owner) USING `(queue = 'KYC'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.support_review_queue_item FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.support_support_case`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `requester_user_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `channel` | `text` | oui | — |
| `category` | `text` | oui | — |
| `priority` | `text` | oui | `'NORMAL'::text` |
| `status` | `text` | oui | `'OPEN'::text` |
| `assignee_id` | `uuid` | non | — |
| `reason` | `text` | non | — |
| `sla_due_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `help_topic` | `text` | non | — |
| `requester_role` | `text` | non | — |
| `off_hours` | `boolean` | non | — |
| `first_response_at` | `timestamp with time zone` | non | — |
| `resolved_at` | `timestamp with time zone` | non | — |

Contraintes :

- `support_case_break_glass_reason` : `CHECK (category <> 'BREAK_GLASS'::text OR reason IS NOT NULL AND length(btrim(reason)) >= 10 AND length(btrim(reason)) <= 2000)`
- `support_case_category_valid` : `CHECK (category = ANY (ARRAY['TRIP'::text, 'PAYMENT'::text, 'ACCOUNT'::text, 'LISTING'::text, 'CLAIM'::text, 'SAFETY'::text, 'OTHER'::text, 'BREAK_GLASS'::text]))`
- `support_case_channel_valid` : `CHECK (channel = ANY (ARRAY['WHATSAPP'::text, 'EMAIL'::text, 'PHONE'::text, 'IN_APP'::text, 'INTERNAL'::text]))`
- `support_case_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `support_case_first_response_after` : `CHECK (first_response_at IS NULL OR first_response_at >= created_at)`
- `support_case_help_shape` : `CHECK (help_topic IS NULL AND requester_role IS NULL AND off_hours IS NULL OR help_topic IS NOT NULL AND requester_role IS NOT NULL AND off_hours IS NOT NULL AND trip_id IS NOT NULL AND requester_user_id IS NOT NULL AND channel = 'IN_APP'::text AND (category = ANY (ARRAY['TRIP'::text, 'SAFETY'::text])))`
- `support_case_help_topic_valid` : `CHECK (help_topic = ANY (ARRAY['ACCIDENT'::text, 'BREAKDOWN'::text, 'HANDOVER'::text, 'SAFETY'::text, 'OTHER'::text]))`
- `support_case_priority_valid` : `CHECK (priority = ANY (ARRAY['LOW'::text, 'NORMAL'::text, 'HIGH'::text, 'URGENT'::text]))`
- `support_case_requester_role_valid` : `CHECK (requester_role = ANY (ARRAY['GUEST'::text, 'HOST'::text]))`
- `support_case_resolved_after` : `CHECK (resolved_at IS NULL OR resolved_at >= created_at)`
- `support_case_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'PENDING'::text, 'RESOLVED'::text, 'CLOSED'::text]))`
- `support_case_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `support_support_case_assignee_id_fkey` : `FOREIGN KEY (assignee_id) REFERENCES core.iam_user_account(id)`
- `support_support_case_pkey` : `PRIMARY KEY (id)`
- `support_support_case_requester_user_id_fkey` : `FOREIGN KEY (requester_user_id) REFERENCES core.iam_user_account(id)`

Index :

- `support_case_help_country_idx` : `CREATE INDEX support_case_help_country_idx ON core.support_support_case USING btree (country_code, created_at) WHERE (help_topic IS NOT NULL)`
- `support_case_help_live_unique` : `CREATE UNIQUE INDEX support_case_help_live_unique ON core.support_support_case USING btree (requester_user_id, trip_id, help_topic) WHERE ((help_topic IS NOT NULL) AND (status = ANY (ARRAY['OPEN'::text, 'PENDING'::text])))`
- `support_case_trip_assignee_idx` : `CREATE INDEX support_case_trip_assignee_idx ON core.support_support_case USING btree (trip_id, assignee_id) WHERE (status = ANY (ARRAY['OPEN'::text, 'PENDING'::text]))`

Politiques RLS :

- `cmd_money_claim_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `(category = 'CLAIM'::text)`
- `iam_staff_help_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((help_topic IS NOT NULL) AND (channel = 'IN_APP'::text) AND (status = 'OPEN'::text) AND (assignee_id IS NULL) AND (reason IS NULL) AND (category <> 'BREAK_GLASS'::text))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((category <> 'BREAK_GLASS'::text) AND (status = 'OPEN'::text) AND (trip_id IS NULL) AND (reason IS NULL))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(category <> 'BREAK_GLASS'::text)` WITH CHECK `(category <> 'BREAK_GLASS'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`
- `privacy_cmd_read` (SELECT, PERMISSIVE, privacy_cmd_owner) USING `true`
- `support_case_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR ((assignee_id = app.actor_id()) AND (app.has_staff_role('OPS_AGENT'::text, country_code) OR app.has_staff_role('SUPPORT_AGENT'::text, country_code)))))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.support_support_case FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.trip_ops_handover_validation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `performer_role` | `text` | oui | — |
| `performed_by` | `uuid` | oui | — |
| `odometer_km` | `integer` | oui | — |
| `fuel_eighths` | `smallint` | oui | — |
| `method` | `text` | oui | — |
| `validated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `trip_handover_validation_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_handover_validation_fuel_range` : `CHECK (fuel_eighths >= 0 AND fuel_eighths <= 8)`
- `trip_handover_validation_kind_valid` : `CHECK (kind = ANY (ARRAY['CHECKIN'::text, 'CHECKOUT'::text]))`
- `trip_handover_validation_method_valid` : `CHECK (method = 'IN_PERSON'::text)`
- `trip_handover_validation_odometer_range` : `CHECK (odometer_km >= 0 AND odometer_km <= 9999999)`
- `trip_handover_validation_pkey` : `PRIMARY KEY (trip_id, kind, performer_role)`
- `trip_handover_validation_role_valid` : `CHECK (performer_role = ANY (ARRAY['HOST'::text, 'GUEST'::text]))`
- `trip_ops_handover_validation_performed_by_fkey` : `FOREIGN KEY (performed_by) REFERENCES core.iam_user_account(id)`
- `trip_ops_handover_validation_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Politiques RLS :

- `cmd_hold_handover_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = performer_role) AND (performed_by = app.actor_id()))`
- `cmd_hold_handover_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_handover_immutable` : `CREATE TRIGGER trip_handover_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_handover_validation FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable')`
- `trip_handover_no_truncate` : `CREATE TRIGGER trip_handover_no_truncate BEFORE TRUNCATE ON core.trip_ops_handover_validation FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable')`

### `core.trip_ops_identity_check`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | — |
| `checklist` | `jsonb` | oui | — |
| `failure_subreason` | `text` | non | — |
| `checked_by` | `uuid` | oui | — |
| `checked_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `trip_identity_check_checklist_shape` : `CHECK (jsonb_typeof(checklist) = 'object'::text AND checklist ?& ARRAY['face'::text, 'name'::text, 'birthYear'::text, 'valid'::text, 'provisional'::text, 'restrictions'::text] AND (checklist - ARRAY['face'::text, 'name'::text, 'birthYear'::text, 'valid'::text, 'provisional'::text, 'restrictions'::text]) = '{}'::jsonb AND jsonb_typeof(checklist -> 'face'::text) = 'boolean'::text AND jsonb_typeof(checklist -> 'name'::text) = 'boolean'::text AND jsonb_typeof(checklist -> 'birthYear'::text) = 'boolean'::text AND jsonb_typeof(checklist -> 'valid'::text) = 'boolean'::text AND jsonb_typeof(checklist -> 'provisional'::text) = 'boolean'::text AND jsonb_typeof(checklist -> 'restrictions'::text) = 'boolean'::text)`
- `trip_identity_check_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_identity_check_failure_coherent` : `CHECK ((status = 'TRIP_ID_FAILED'::text) = (failure_subreason IS NOT NULL))`
- `trip_identity_check_pkey` : `PRIMARY KEY (trip_id)`
- `trip_identity_check_status_valid` : `CHECK (status = ANY (ARRAY['TRIP_ID_OK'::text, 'TRIP_ID_FAILED'::text]))`
- `trip_identity_check_subreason_valid` : `CHECK (failure_subreason = ANY (ARRAY['INVALID_LICENSE'::text, 'IDENTITY_NOT_VERIFIED'::text, 'OTHER_DRIVER_SENT'::text]))`
- `trip_ops_identity_check_checked_by_fkey` : `FOREIGN KEY (checked_by) REFERENCES core.iam_user_account(id)`
- `trip_ops_identity_check_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Politiques RLS :

- `cmd_hold_handover_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'HOST'::text) AND (checked_by = app.actor_id()))`
- `cmd_hold_handover_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_handover_immutable` : `CREATE TRIGGER trip_handover_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_identity_check FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable')`
- `trip_handover_no_truncate` : `CREATE TRIGGER trip_handover_no_truncate BEFORE TRUNCATE ON core.trip_ops_identity_check FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable')`

### `core.trip_ops_inspection`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `performer_role` | `text` | oui | — |
| `performed_by` | `uuid` | oui | — |
| `template_version` | `smallint` | oui | — |
| `status` | `text` | oui | `'DRAFT'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `submitted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `trip_inspection_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_inspection_kind_valid` : `CHECK (kind = ANY (ARRAY['CHECKIN'::text, 'CHECKOUT'::text]))`
- `trip_inspection_one_per_side` : `UNIQUE (trip_id, kind, performer_role)`
- `trip_inspection_pkey` : `PRIMARY KEY (id)`
- `trip_inspection_role_valid` : `CHECK (performer_role = ANY (ARRAY['HOST'::text, 'GUEST'::text]))`
- `trip_inspection_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text]))`
- `trip_inspection_submitted_coherent` : `CHECK ((status = 'SUBMITTED'::text) = (submitted_at IS NOT NULL))`
- `trip_ops_inspection_performed_by_fkey` : `FOREIGN KEY (performed_by) REFERENCES core.iam_user_account(id)`
- `trip_ops_inspection_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Politiques RLS :

- `cmd_hold_inspection_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((status = 'DRAFT'::text) AND (submitted_at IS NULL))`
- `cmd_hold_inspection_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_inspection_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `true` WITH CHECK `(status = 'SUBMITTED'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_inspection_immutable` : `CREATE TRIGGER trip_inspection_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_inspection FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard()`
- `trip_inspection_no_truncate` : `CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_inspection FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable')`

### `core.trip_ops_inspection_photo`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `inspection_id` | `uuid` | oui | — |
| `slot_code` | `text` | oui | — |
| `file_id` | `uuid` | oui | — |
| `taken_by_role` | `text` | oui | — |
| `capture_id` | `uuid` | oui | — |
| `sha256` | `bytea` | oui | — |
| `bytes` | `bigint` | oui | — |
| `received_at` | `timestamp with time zone` | oui | `platform.now()` |
| `device_captured_at` | `timestamp with time zone` | non | — |
| `clock_skew_flag` | `boolean` | oui | — |

Contraintes :

- `trip_inspection_photo_bytes_positive` : `CHECK (bytes > 0)`
- `trip_inspection_photo_capture_unique` : `UNIQUE (capture_id)`
- `trip_inspection_photo_file_unique` : `UNIQUE (file_id)`
- `trip_inspection_photo_pkey` : `PRIMARY KEY (inspection_id, slot_code, file_id)`
- `trip_inspection_photo_role_valid` : `CHECK (taken_by_role = ANY (ARRAY['HOST'::text, 'GUEST'::text]))`
- `trip_inspection_photo_sha256_size` : `CHECK (octet_length(sha256) = 32)`
- `trip_ops_inspection_photo_capture_id_fkey` : `FOREIGN KEY (capture_id) REFERENCES core.trip_ops_photo_capture(id)`
- `trip_ops_inspection_photo_file_id_fkey` : `FOREIGN KEY (file_id) REFERENCES core.audit_file_asset(id)`
- `trip_ops_inspection_photo_inspection_id_fkey` : `FOREIGN KEY (inspection_id) REFERENCES core.trip_ops_inspection(id)`

Index :

- `trip_inspection_photo_sha256_unique` : `CREATE UNIQUE INDEX trip_inspection_photo_sha256_unique ON core.trip_ops_inspection_photo USING btree (sha256)`

Politiques RLS :

- `cmd_hold_inspection_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `true`
- `cmd_hold_inspection_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_inspection_immutable` : `CREATE TRIGGER trip_inspection_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_inspection_photo FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard()`
- `trip_inspection_no_truncate` : `CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_inspection_photo FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable')`

### `core.trip_ops_key_handover`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `trip_id` | `uuid` | oui | — |
| `direction` | `text` | oui | — |
| `method` | `text` | oui | — |
| `at` | `timestamp with time zone` | oui | — |
| `by_user` | `uuid` | oui | — |

Contraintes :

- `trip_key_handover_direction_valid` : `CHECK (direction = ANY (ARRAY['OUT'::text, 'IN'::text]))`
- `trip_key_handover_method_valid` : `CHECK (method = 'IN_PERSON'::text)`
- `trip_key_handover_one_per_direction` : `UNIQUE (trip_id, direction)`
- `trip_key_handover_pkey` : `PRIMARY KEY (id)`
- `trip_ops_key_handover_by_user_fkey` : `FOREIGN KEY (by_user) REFERENCES core.iam_user_account(id)`
- `trip_ops_key_handover_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Politiques RLS :

- `cmd_hold_handover_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `(app.actor_kind() = ANY (ARRAY['HOST'::text, 'GUEST'::text]))`
- `cmd_hold_handover_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_handover_immutable` : `CREATE TRIGGER trip_handover_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_key_handover FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable')`
- `trip_handover_no_truncate` : `CREATE TRIGGER trip_handover_no_truncate BEFORE TRUNCATE ON core.trip_ops_key_handover FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_handover_immutable')`

### `core.trip_ops_overdue_case`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `stage` | `text` | oui | `'T30M'::text` |
| `scheduled_end` | `timestamp with time zone` | oui | — |
| `detection_minutes` | `integer` | oui | — |
| `detected_at` | `timestamp with time zone` | oui | — |
| `use_until` | `timestamp with time zone` | oui | — |
| `occupancy_until` | `timestamp with time zone` | oui | — |
| `bounded` | `boolean` | oui | `false` |
| `next_trip_id` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `trip_ops_overdue_case_next_trip_id_fkey` : `FOREIGN KEY (next_trip_id) REFERENCES core.booking_trip(id)`
- `trip_ops_overdue_case_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `trip_overdue_case_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_overdue_case_detected_after_end` : `CHECK (detected_at >= scheduled_end)`
- `trip_overdue_case_minutes_range` : `CHECK (detection_minutes >= 0 AND detection_minutes <= 1440)`
- `trip_overdue_case_next_differs` : `CHECK (next_trip_id IS DISTINCT FROM trip_id)`
- `trip_overdue_case_pkey` : `PRIMARY KEY (id)`
- `trip_overdue_case_stage_valid` : `CHECK (stage = ANY (ARRAY['T30M'::text, 'T2H'::text, 'T6H'::text, 'T24H'::text, 'RESOLVED'::text]))`
- `trip_overdue_case_trip_unique` : `UNIQUE (trip_id)`

Politiques RLS :

- `cmd_hold_overdue_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((stage = 'T30M'::text) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))`
- `cmd_hold_overdue_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))`
- `cmd_hold_overdue_staff_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(app.actor_kind() = 'STAFF'::text)`
- `cmd_hold_overdue_staff_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (stage = ANY (ARRAY['T30M'::text, 'T2H'::text, 'T6H'::text])))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (stage = ANY (ARRAY['T2H'::text, 'T6H'::text, 'T24H'::text])))`
- `cmd_hold_overdue_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_overdue'::text))`
- `iam_staff_rpt_read` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_overdue_case_guard` : `CREATE TRIGGER trip_overdue_case_guard BEFORE DELETE OR UPDATE ON core.trip_ops_overdue_case FOR EACH ROW EXECUTE FUNCTION core.trip_overdue_case_guard()`

### `core.trip_ops_overdue_escalation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `case_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `from_stage` | `text` | oui | — |
| `stage` | `text` | oui | — |
| `documents` | `text[]` | oui | — |
| `escalated_at` | `timestamp with time zone` | oui | — |
| `due_at` | `timestamp with time zone` | oui | — |
| `event_id` | `uuid` | oui | — |

Contraintes :

- `trip_ops_overdue_escalation_case_id_fkey` : `FOREIGN KEY (case_id) REFERENCES core.trip_ops_overdue_case(id)`
- `trip_ops_overdue_escalation_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `trip_overdue_escalation_after_due` : `CHECK (escalated_at >= due_at)`
- `trip_overdue_escalation_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_overdue_escalation_documents_valid` : `CHECK (cardinality(documents) >= 1 AND cardinality(documents) <= 4 AND array_position(documents, NULL::text) IS NULL AND documents <@ ARRAY['CONTACT_SCRIPT'::text, 'DEMAND_LETTER'::text, 'GPS_REQUEST'::text, 'POLICE_REPORT_DRAFT'::text])`
- `trip_overdue_escalation_from_valid` : `CHECK (from_stage = ANY (ARRAY['T30M'::text, 'T2H'::text, 'T6H'::text]))`
- `trip_overdue_escalation_order` : `CHECK (from_stage = 'T30M'::text AND stage = 'T2H'::text OR from_stage = 'T2H'::text AND stage = 'T6H'::text OR from_stage = 'T6H'::text AND stage = 'T24H'::text)`
- `trip_overdue_escalation_pkey` : `PRIMARY KEY (id)`
- `trip_overdue_escalation_stage_valid` : `CHECK (stage = ANY (ARRAY['T2H'::text, 'T6H'::text, 'T24H'::text]))`
- `trip_overdue_escalation_unique` : `UNIQUE (trip_id, stage)`

Index :

- `trip_overdue_escalation_case_idx` : `CREATE INDEX trip_overdue_escalation_case_idx ON core.trip_ops_overdue_escalation USING btree (case_id)`

Politiques RLS :

- `cmd_hold_escalation_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `(app.actor_kind() = 'STAFF'::text)`
- `cmd_hold_escalation_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(app.actor_kind() = 'STAFF'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_overdue_escalation_guard` : `CREATE TRIGGER trip_overdue_escalation_guard BEFORE DELETE OR UPDATE ON core.trip_ops_overdue_escalation FOR EACH ROW EXECUTE FUNCTION core.trip_overdue_escalation_guard()`

### `core.trip_ops_photo_capture`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `inspection_id` | `uuid` | oui | — |
| `slot_code` | `text` | oui | — |
| `issued_to` | `uuid` | oui | — |
| `issued_at` | `timestamp with time zone` | oui | `platform.now()` |
| `expires_at` | `timestamp with time zone` | oui | — |
| `used_at` | `timestamp with time zone` | non | — |

Contraintes :

- `trip_ops_photo_capture_inspection_id_fkey` : `FOREIGN KEY (inspection_id) REFERENCES core.trip_ops_inspection(id)`
- `trip_ops_photo_capture_issued_to_fkey` : `FOREIGN KEY (issued_to) REFERENCES core.iam_user_account(id)`
- `trip_photo_capture_expiry` : `CHECK (expires_at > issued_at)`
- `trip_photo_capture_pkey` : `PRIMARY KEY (id)`
- `trip_photo_capture_used` : `CHECK (used_at IS NULL OR used_at >= issued_at)`

Index :

- `trip_photo_capture_inspection_idx` : `CREATE INDEX trip_photo_capture_inspection_idx ON core.trip_ops_photo_capture USING btree (inspection_id)`

Politiques RLS :

- `cmd_hold_inspection_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `(used_at IS NULL)`
- `cmd_hold_inspection_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_inspection_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `true` WITH CHECK `(used_at IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_inspection_immutable` : `CREATE TRIGGER trip_inspection_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_photo_capture FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard()`
- `trip_inspection_no_truncate` : `CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_photo_capture FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable')`

### `core.trip_ops_photo_slot`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_hold_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `template_version` | `smallint` | oui | — |
| `slot_code` | `text` | oui | — |
| `slot_group` | `text` | oui | — |
| `required` | `boolean` | oui | — |
| `position` | `smallint` | oui | — |

Contraintes :

- `trip_photo_slot_code_format` : `CHECK (slot_code ~ '^(EXT_[0-9]{2}\|INT_[0-9]{2}\|FUEL\|ODOMETER\|KEY\|DAMAGE_[0-9]{2})$'::text)`
- `trip_photo_slot_group_valid` : `CHECK (slot_group = ANY (ARRAY['EXTERIOR'::text, 'INTERIOR'::text, 'FUEL'::text, 'ODOMETER'::text, 'KEY'::text, 'DAMAGE'::text]))`
- `trip_photo_slot_pkey` : `PRIMARY KEY (template_version, slot_code)`
- `trip_photo_slot_position_range` : `CHECK ("position" >= 1 AND "position" <= 99)`
- `trip_photo_slot_position_unique` : `UNIQUE (template_version, "position")`
- `trip_photo_slot_version_positive` : `CHECK (template_version >= 1)`

Politiques RLS :

- `cmd_hold_inspection_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `trip_inspection_immutable` : `CREATE TRIGGER trip_inspection_immutable BEFORE DELETE OR UPDATE ON core.trip_ops_photo_slot FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard()`
- `trip_inspection_no_truncate` : `CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_photo_slot FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable')`

### `platform.environment_declaration`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : guard_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `singleton` | `boolean` | oui | `true` |
| `environment` | `text` | oui | — |
| `declared_at` | `timestamp with time zone` | oui | `platform.now()` |
| `declared_by` | `text` | oui | `CURRENT_USER` |

Contraintes :

- `environment_declaration_environment_check` : `CHECK (environment = ANY (ARRAY['development'::text, 'preproduction'::text, 'production'::text]))`
- `environment_declaration_pkey` : `PRIMARY KEY (singleton)`
- `environment_declaration_singleton_check` : `CHECK (singleton)`

Politiques RLS :

- `guard_read` (SELECT, PERMISSIVE, guard_owner) USING `true`
- `migrator_declare` (INSERT, PERMISSIVE, migrator) WITH CHECK `true`
- `migrator_delete_refused` (DELETE, PERMISSIVE, migrator) USING `true`
- `migrator_read` (SELECT, PERMISSIVE, migrator) USING `true`
- `migrator_update_refused` (UPDATE, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `environment_declaration_no_truncate` : `CREATE TRIGGER environment_declaration_no_truncate BEFORE TRUNCATE ON platform.environment_declaration FOR EACH STATEMENT EXECUTE FUNCTION platform.environment_declaration_immutable()`
- `environment_declaration_no_update` : `CREATE TRIGGER environment_declaration_no_update BEFORE DELETE OR UPDATE ON platform.environment_declaration FOR EACH ROW EXECUTE FUNCTION platform.environment_declaration_immutable()`

### `platform.schema_migration`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `version` | `text` | oui | — |
| `name` | `text` | oui | — |
| `checksum` | `text` | oui | — |
| `applied_at` | `timestamp with time zone` | oui | `platform.now()` |
| `applied_by` | `name` | oui | `CURRENT_USER` |

Contraintes :

- `schema_migration_checksum_check` : `CHECK (checksum ~ '^[0-9a-f]{64}$'::text)`
- `schema_migration_name_check` : `CHECK (name ~ '^[a-z0-9_]+$'::text)`
- `schema_migration_pkey` : `PRIMARY KEY (version)`
- `schema_migration_version_check` : `CHECK (version ~ '^[0-9]{4}$'::text)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

## Vues

### `core.booking_host_guest_v`

- view ; propriétaire `migrator` ; droits : app_api: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `trip_id` uuid, `first_name` text, `age_years` integer, `rating` numeric, `verification_status` text

### `core.report_exit_kpi_v`

- view ; propriétaire `migrator` ; droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `country_code` text, `s1_active_hosts` bigint, `s2_completed_trips` bigint, `s2_double_bookings` bigint, `s2_keys_unpaid` bigint, `s4_unexplained_items` bigint, `s4_months_closed` bigint

### `core.report_handover_day_v`

- view ; propriétaire `migrator` ; droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `trip_id` uuid, `public_ref` text, `country_code` text, `org_id` uuid, `vehicle_id` uuid, `status` text, `kind` text, `planned_at` timestamp with time zone, `host_validated` boolean, `guest_validated` boolean, `keys_at` timestamp with time zone

### `core.report_overdue_v`

- view ; propriétaire `migrator` ; droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `trip_id` uuid, `public_ref` text, `country_code` text, `org_id` uuid, `vehicle_id` uuid, `status` text, `stage` text, `scheduled_end` timestamp with time zone, `detected_at` timestamp with time zone, `minutes_late` bigint, `use_until` timestamp with time zone, `bounded` boolean, `next_trip_id` uuid

### `core.settlement_host_advance_v`

- view ; propriétaire `migrator` ; droits : app_api: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `id` uuid, `trip_id` uuid, `country_code` text, `currency` text, `amount_minor` bigint, `receivable_minor` bigint, `recovered_minor` bigint, `outstanding_minor` bigint, `status` text, `created_at` timestamp with time zone

### `core.settlement_host_ledger_balance_v`

- view ; propriétaire `migrator` ; droits : app_api: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `org_id` uuid, `country_code` text, `currency` text, `balance_minor` bigint, `entries` integer, `last_entry_at` timestamp with time zone

## Fonctions `SECURITY DEFINER`

Chacune a un propriétaire `NOLOGIN` dédié (ADR-053) et un `search_path` figé ; EXECUTE accordé nommément (jamais PUBLIC). Liste blanche : `packages/db/security-definer-allowlist.json`.

| Fonction | Résultat | Propriétaire | Configuration | EXECUTE |
| -------- | -------- | ------------ | ------------- | ------- |
| `app.has_permission(p_code text)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.has_staff_role(p_role text, p_country text)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.host_covers_vehicle(p_vehicle_id uuid)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE ; host_view_owner: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.is_org_holder()` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.staff_case_covers(p_object_type text, p_object_id uuid)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `core.audit_log_chain()` | `trigger` | `audit_chain_owner` | search_path=pg_catalog, pg_temp | audit_chain_owner: EXECUTE |
| `core.booking_assert_conversion_disposition()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.booking_assert_rent_payment_operation()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.booking_assert_trip_occupancy()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.booking_checkout_capture_terms(p_hold_id uuid)` | `TABLE(amount_minor bigint, currency text, legs jsonb, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, timezone text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; host_view_owner: EXECUTE |
| `core.booking_checkout_host_name(p_token_hash bytea, p_quote_id uuid)` | `TABLE(quote_id uuid, host_name text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_payment(p_token_hash bytea, p_hold_id uuid)` | `TABLE(outcome text, hold_status text, trip_id uuid, expires_at timestamp with time zone, payment_in_flight_until timestamp with time zone, operation_status text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_protection(p_token_hash bytea, p_quote_id uuid)` | `TABLE(quote_id uuid, protection_level text, driver_age integer, frozen_at timestamp with time zone, insurer_contract_active boolean)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_quote(p_token_hash bytea, p_quote_id uuid)` | `TABLE(quote_id uuid, listing_id uuid, country_code text, currency text, start_at timestamp with time zone, end_at timestamp with time zone, billable_days integer, lines jsonb, total_minor bigint, expires_at timestamp with time zone, expired boolean, manual_transmission boolean, instant_book boolean, documents jsonb)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_request(p_token_hash bytea, p_hold_id uuid)` | `TABLE(outcome text, hold_kind text, request_status text, request_respond_by timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_return_place(p_token_hash bytea, p_quote_id uuid, p_return_location_id uuid)` | `TABLE(outcome text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_review_state(p_token_hash bytea, p_hold_id uuid)` | `TABLE(hold_id uuid, review_state text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_checkout_summary(p_token_hash bytea, p_hold_id uuid)` | `TABLE(hold_id uuid, status text, expires_at timestamp with time zone, quote_id uuid, listing_id uuid, currency text, start_at timestamp with time zone, end_at timestamp with time zone, total_minor bigint, manual_confirmed_at timestamp with time zone, documents jsonb)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_accept_booking_request(p_token_hash bytea, p_org uuid, p_hold_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_checkout(p_token_hash bytea, p_quote_id uuid, p_driver_first text, p_driver_last text, p_manual_confirmed boolean, p_documents jsonb)` | `TABLE(outcome text, hold_id uuid, expires_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_checkout_pay(p_token_hash bytea, p_hold_id uuid, p_method text)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_checkout_record_order(p_token_hash bytea, p_hold_id uuid, p_operation_id uuid, p_provider_reference text, p_order_expires_at timestamp with time zone)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_decline_booking_request(p_token_hash bytea, p_org uuid, p_hold_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_expire_booking_requests(p_limit integer)` | `integer` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_place_buffer(p_trip_id uuid, p_start timestamp with time zone)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_place_hold(p_vehicle_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_flagged boolean)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_place_host_block(p_vehicle_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_record_contract(p_trip_id uuid, p_trigger_key text, p_facts jsonb, p_derived jsonb, p_body jsonb, p_template_id uuid, p_courtesy_template_id uuid, p_renderer text, p_sha256 bytea)` | `TABLE(outcome text, document_id uuid, version integer)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_record_order(p_hold_id uuid, p_operation_id uuid, p_provider_reference text, p_order_expires_at timestamp with time zone)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_release_own_hold(p_hold_id uuid)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_remove_host_block(p_block_id uuid)` | `boolean` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_report_self_booking(p_vehicle_id uuid)` | `void` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_request_record_capture(p_token_hash bytea, p_org uuid, p_hold_id uuid, p_operation_id uuid, p_provider_reference text)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_sign_contract(p_token_hash bytea, p_trip_id uuid, p_document_id uuid, p_presented_sha256 bytea)` | `TABLE(outcome text, signature_id uuid, signed_at timestamp with time zone, seal_sha256 text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_start_payment(p_hold_id uuid, p_psp_account_id uuid, p_method text)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_trip_cancel(p_trip_id uuid, p_reason text, p_initiator text, p_sub_reason text, p_evidence_validated boolean, p_expected_row_version integer)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_trip_park_cancellation(p_cancellation_id uuid, p_status text, p_code text)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_trip_settle_cancellation(p_cancellation_id uuid, p_settlement_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_trip_transition(p_trip_id uuid, p_to_status text, p_reason_code text, p_expected_row_version integer)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_contract_source(p_trip_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_conversion_eligibility(p_hold_id uuid)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_guest_trips(p_token_hash bytea, p_tab text, p_trip_id uuid, p_limit integer)` | `TABLE(outcome text, kind text, item_id uuid, public_ref text, tab text, status text, payment_status text, currency text, timezone text, starts_at timestamp with time zone, ends_at timestamp with time zone, respond_by timestamp with time zone, vehicle_make text, vehicle_model text, vehicle_year integer, host_name text, place_label text, place_address text, place_city text, total_minor bigint, contract_state text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_hold_review_item_close()` | `trigger` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE |
| `core.booking_host_constancia_search(p_token_hash bytea, p_plate text, p_date date)` | `TABLE(outcome text, trip_id uuid, public_ref text, status text, start_local text, end_local text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_host_earnings(p_token_hash bytea, p_org uuid, p_month text)` | `TABLE(outcome text, country_code text, statements jsonb)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_host_guest_rows()` | `TABLE(trip_id uuid, first_name text, age_years integer, rating numeric, verification_status text)` | `host_view_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; host_view_owner: EXECUTE |
| `core.booking_host_requests(p_token_hash bytea, p_org uuid, p_hold_id uuid, p_limit integer)` | `TABLE(outcome text, hold_id uuid, status text, vehicle_id uuid, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, timezone text, request_respond_by timestamp with time zone, currency text, total_minor bigint, host_leg_minor bigint, guest_first_name text, guest_age_years integer, guest_rating numeric, guest_verified boolean)` | `host_view_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; host_view_owner: EXECUTE |
| `core.booking_host_trips(p_token_hash bytea, p_org uuid, p_tab text, p_vehicle_id uuid, p_from date, p_to date, p_trip_id uuid, p_limit integer)` | `TABLE(outcome text, trip_id uuid, public_ref text, tab text, status text, vehicle_id uuid, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, timezone text, booked_at timestamp with time zone, payment_status text, currency text, host_leg_minor bigint, guest_first_name text, guest_age_years integer, guest_rating numeric, guest_verified boolean)` | `host_view_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; host_view_owner: EXECUTE |
| `core.booking_manual_action_cancel_host_trips(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.booking_manual_action_cancel_trip(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.booking_manual_action_no_show(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.booking_manual_action_review_flagged(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.booking_notification_parties(p_subject text, p_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_notify_host_restricted(p_holder uuid, p_actor uuid, p_actor_role text, p_causation uuid)` | `uuid[]` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.booking_notify_host_restriction_lifted(p_holder uuid, p_actor uuid, p_actor_role text, p_causation uuid)` | `uuid[]` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.booking_request_authorized(p_operation_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_request_void(p_hold_id uuid, p_auth_op uuid)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_staff_review_dossier(p_assessment uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.booking_staff_trip_cancellation(p_trip_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.booking_trip_birth_defaults()` | `trigger` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE |
| `core.booking_trip_birth_records()` | `trigger` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE |
| `core.booking_trip_cancellation_begin(p_cancellation_id uuid)` | `TABLE(cancellation_id uuid, trip_id uuid, segment_id uuid, country_code text, currency text, trip_status text, trip_row_version integer, start_at_ms bigint, booked_at_ms bigint, requested_reason text, initiator text, sub_reason text, evidence_validated boolean, checkin_validated boolean, requested_at_ms bigint, quote_engine_version text, quote_inputs text, quote_inputs_hash text, quote_outputs text, quote_outputs_hash text, quote_total_minor text, quote_currency text, params jsonb)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_trip_cancellation_flags(p_cancellation_id uuid)` | `TABLE(host_message_traced boolean)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_trip_cancellations_pending(p_limit integer)` | `TABLE(id uuid)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_trip_constancia(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, viewer_role text, viewer_locale text, trip_status text, contract_version integer, terms jsonb, brand text, host_name text, guest_name text, plate text, handover_place text, handover_city text, signed_at_local text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_trip_contract(p_token_hash bytea, p_trip_id uuid, p_version integer)` | `TABLE(outcome text, viewer_role text, document_id uuid, version integer, latest_version integer, locale text, generated_at timestamp with time zone, sha256 text, renderer_version text, terms jsonb, derived jsonb, body jsonb, is_draft boolean, signature_id uuid, signed_at timestamp with time zone, seal_sha256 text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_trip_period_sync()` | `trigger` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE |
| `core.booking_trip_receipt(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, viewer_role text, trip_status text, currency text, timezone text, receipt jsonb)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_trip_refunds(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, viewer_role text, trip_status text, currency text, timezone text, refunds jsonb)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_worker_no_show_review_alerts(p_batch integer)` | `TABLE(country_code text, reason text, reports integer)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.catalog_addition_detail(p_addition_id uuid, p_country text)` | `jsonb` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_cmd_add_listing_photo(p_token_hash bytea, p_org uuid, p_listing_id uuid, p_photo_id uuid, p_file_id uuid, p_mime text, p_bytes bigint, p_sha256 bytea)` | `TABLE(outcome text, photo_id uuid, storage_key text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_add_vehicle_document(p_token_hash bytea, p_org uuid, p_vehicle uuid, p_file_id uuid, p_doc_type text, p_mime text, p_bytes bigint, p_sha256 bytea, p_valid_until date)` | `TABLE(outcome text, document_id uuid, storage_key text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_create_listing(p_token_hash bytea, p_org uuid, p_vehicle_id uuid, p_daily_price_minor bigint, p_mileage_mode text, p_included_km_per_day integer, p_extra_km_price_minor bigint, p_instant_book boolean)` | `TABLE(outcome text, listing_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_create_location(p_token_hash bytea, p_org uuid, p_kind text, p_label text, p_address_line text, p_city text, p_area_label text, p_lat numeric, p_lng numeric)` | `TABLE(outcome text, location_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_create_vehicle(p_token_hash bytea, p_org uuid, p_location_id uuid, p_plate text, p_vin text, p_variant_id uuid, p_make_text text, p_model_text text, p_year integer, p_trim text, p_transmission text, p_seats smallint, p_fuel_type text, p_odometer_km integer, p_gps_installed boolean, p_lien_declared boolean)` | `TABLE(outcome text, vehicle_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_declare_vehicle(p_token_hash bytea, p_org uuid, p_vehicle uuid, p_title_holder text, p_lien_declared boolean, p_odometer_km integer, p_ownership_attested boolean, p_lien_attested boolean, p_vin text)` | `TABLE(outcome text, vehicle_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_declare_vehicle(p_token_hash bytea, p_org uuid, p_vehicle uuid, p_title_holder text, p_lien_declared boolean, p_odometer_km integer, p_ownership_attested boolean, p_lien_attested boolean, p_vin text, p_locale text, p_catalog_version integer, p_ownership_text text, p_lien_text text)` | `TABLE(outcome text, vehicle_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_delete_listing(p_token_hash bytea, p_org uuid, p_listing_id uuid)` | `TABLE(outcome text, listing_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_open_vehicle_claim(p_token_hash bytea, p_org uuid, p_plate text, p_vin text, p_file_id uuid, p_mime text, p_bytes bigint, p_sha256 bytea)` | `TABLE(outcome text, claim_id uuid, storage_key text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_place_host_block(p_token_hash bytea, p_org uuid, p_vehicle_id uuid, p_start_local timestamp without time zone, p_end_local timestamp without time zone)` | `TABLE(outcome text, block_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_remove_host_block(p_token_hash bytea, p_org uuid, p_vehicle_id uuid, p_block_id uuid)` | `TABLE(outcome text, block_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_request_addition(p_token_hash bytea, p_org uuid, p_vehicle_id uuid, p_make_text text, p_model_text text, p_trim text)` | `TABLE(outcome text, request_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_set_earnings_plan(p_token_hash bytea, p_org uuid, p_vehicle_id uuid, p_plan_code text)` | `TABLE(outcome text, plan_code text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_set_location_notice(p_token_hash bytea, p_org uuid, p_location_id uuid, p_minutes integer)` | `TABLE(outcome text, location_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_submit_listing(p_token_hash bytea, p_org uuid, p_listing_id uuid)` | `TABLE(outcome text, listing_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_submit_vehicle_eligibility(p_token_hash bytea, p_org uuid, p_vehicle uuid)` | `TABLE(outcome text, item_id uuid, reasons text[])` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_unlist_listing(p_token_hash bytea, p_org uuid, p_listing_id uuid)` | `TABLE(outcome text, listing_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_cmd_update_listing_pricing(p_token_hash bytea, p_org uuid, p_listing_id uuid, p_daily_price_minor bigint, p_mileage_mode text, p_included_km_per_day integer, p_extra_km_price_minor bigint)` | `TABLE(outcome text, listing_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_guest_meeting_point(p_token_hash bytea, p_listing_id uuid)` | `TABLE(place_label text, address_line text, city text, area_label text, location_kind text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_addition_requests(p_token_hash bytea, p_org uuid)` | `TABLE(request_id uuid, vehicle_id uuid, status text, make_text text, model_text text, reject_reason text, sla_due_at timestamp with time zone, created_at timestamp with time zone, reviewed_at timestamp with time zone)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_earnings_plans(p_token_hash bytea, p_org uuid)` | `TABLE(vehicle_id uuid, plan_code text, chosen boolean, chosen_at timestamp with time zone, default_plan text, offered jsonb)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_listings(p_token_hash bytea, p_org uuid)` | `TABLE(listing_id uuid, vehicle_id uuid, status text, daily_price_minor bigint, currency text, mileage_mode text, included_km_per_day integer, extra_km_price_minor bigint, instant_book boolean, photos integer, submitted_at timestamp with time zone)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_locations(p_token_hash bytea, p_org uuid)` | `TABLE(location_id uuid, kind text, place_label text, address_line text, city text, area_label text, geo_lat numeric, geo_lng numeric, timezone text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_vehicle_calendar(p_token_hash bytea, p_org uuid, p_vehicle_id uuid)` | `TABLE(outcome text, timezone text, listed boolean, location_id uuid, notice_minutes integer, effective_notice_minutes integer)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_vehicle_claims(p_token_hash bytea, p_org uuid)` | `TABLE(claim_id uuid, plate text, status text, dismiss_reason text, created_at timestamp with time zone, decided_at timestamp with time zone)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_vehicle_eligibility(p_token_hash bytea, p_org uuid)` | `TABLE(vehicle_id uuid, body jsonb)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_vehicle_occupancies(p_token_hash bytea, p_org uuid, p_vehicle_id uuid)` | `TABLE(occupancy_id uuid, kind text, source text, starts_at timestamp with time zone, ends_at timestamp with time zone, start_local text, end_local text, removable boolean)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_host_vehicles(p_token_hash bytea, p_org uuid)` | `TABLE(vehicle_id uuid, location_id uuid, plate text, vin text, variant_id uuid, make_text text, model_text text, year integer, trim_override text, value_class text, transmission text, seats smallint, fuel_type text, odometer_km integer, gps_installed boolean, lien_declared boolean, eligibility_status text, listing_id uuid, listing_status text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_listing_decide(p_listing uuid, p_country text, p_actor uuid, p_actor_role text, p_decision text, p_reason text)` | `TABLE(outcome text, status text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_listing_earnings_plan(p_listing_id uuid)` | `text` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.catalog_public_areas(p_country text)` | `TABLE(country_code text, city text, area_label text, timezone text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_cards(p_country text, p_city text, p_area text, p_start_local timestamp without time zone, p_end_local timestamp without time zone, p_limit integer)` | `TABLE(outcome text, listing_id uuid, daily_price_minor bigint, currency text, instant_book boolean, make_name text, model_name text, year integer, transmission text, seats smallint, fuel_type text, location_kind text, city text, area_label text, geo_public_lat numeric, geo_public_lng numeric, timezone text, start_at timestamp with time zone, end_at timestamp with time zone, deposit_amount_minor bigint, quoted_at timestamp with time zone)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_deposit_basis(p_listing_ids uuid[])` | `TABLE(listing_id uuid, country_code text, currency text, value_class text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_gallery(p_listing_id uuid)` | `TABLE(photo_id uuid, photo_order smallint, storage_key text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_host_name(p_listing_id uuid)` | `TABLE(host_first_name text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_listing(p_listing_id uuid)` | `TABLE(listing_id uuid, country_code text, daily_price_minor bigint, currency text, mileage_mode text, included_km_per_day integer, extra_km_price_minor bigint, instant_book boolean, variant_id uuid, make_name text, model_name text, year integer, transmission text, seats smallint, fuel_type text, location_kind text, city text, area_label text, geo_public_lat numeric, geo_public_lng numeric, timezone text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.catalog_public_request_terms(p_country text)` | `TABLE(request_mode_enabled boolean, request_expiry_hours integer)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_search(p_country text, p_city text, p_area text, p_start_local timestamp without time zone, p_end_local timestamp without time zone, p_limit integer)` | `TABLE(outcome text, listing_id uuid, daily_price_minor bigint, currency text, instant_book boolean, make_name text, model_name text, year integer, transmission text, seats smallint, fuel_type text, location_kind text, city text, area_label text, geo_public_lat numeric, geo_public_lng numeric, timezone text, start_at timestamp with time zone, end_at timestamp with time zone)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_slot_check(p_listing_id uuid, p_start_local timestamp without time zone, p_end_local timestamp without time zone)` | `TABLE(outcome text, start_at timestamp with time zone, end_at timestamp with time zone, timezone text, notice_minutes integer)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_public_terms(p_listing_id uuid, p_start timestamp with time zone)` | `TABLE(listing_id uuid, currency text, timezone text, read_at timestamp with time zone, free_cancel_lead_hours integer, last_minute_threshold_hours integer, last_minute boolean, free_until timestamp with time zone, last_minute_window_minutes integer, mileage_mode text, included_km_per_day integer, extra_km_price_minor bigint, deposit_amount_minor bigint, protection_offered boolean, insurer_name text, insurer_license_ref text, broker_name text, broker_license_ref text, contract_version integer, rc_amount_minor bigint, deductibles jsonb, exclusions jsonb)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_resolve_addition(p_addition_id uuid, p_country text, p_actor uuid, p_actor_role text, p_decision text, p_variant_id uuid, p_entry jsonb, p_reject_reason text, p_correlation uuid)` | `TABLE(outcome text, status text, variant_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_vehicle_claim_decide(p_claim uuid, p_country text, p_actor uuid, p_actor_role text, p_decision text, p_reason text, p_checklist jsonb, p_correlation uuid)` | `TABLE(outcome text, status text, target_vehicle_id uuid, bookings jsonb)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_vehicle_claim_dossier(p_claim uuid, p_country text)` | `jsonb` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_vehicle_claim_permitted(p_token_hash bytea, p_org uuid, p_plate text, p_vin text)` | `TABLE(outcome text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_vehicle_decide(p_vehicle uuid, p_country text, p_actor uuid, p_actor_role text, p_checklist jsonb, p_documents jsonb, p_item uuid)` | `TABLE(outcome text, result text, reasons text[])` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_vehicle_document_permitted(p_token_hash bytea, p_org uuid, p_vehicle uuid)` | `TABLE(outcome text)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE |
| `core.catalog_vehicle_dossier(p_vehicle uuid, p_country text)` | `jsonb` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_vehicle_file(p_subject_type text, p_subject_id uuid, p_country text, p_file_id uuid)` | `TABLE(storage_key text, mime text, bytes bigint, subject_user_id uuid)` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.catalog_vehicle_is_free(p_vehicle_id uuid, p_period tstzrange)` | `boolean` | `catalog_probe_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; catalog_probe_owner: EXECUTE |
| `core.catalog_vehicle_publishable(p_vehicle uuid)` | `boolean` | `catalog_cmd_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE |
| `core.cfg_brand_cmd_publish(p_token_hash bytea, p_request_id uuid, p_version_id uuid, p_contrast_check jsonb)` | `TABLE(outcome text, version_id uuid, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_cmd_register_asset(p_token_hash bytea, p_request_id uuid, p_asset_id uuid, p_kind text, p_mime text, p_bytes bigint, p_sha256 bytea, p_alt_es text, p_alt_en text, p_alt_fr text, p_alt_pt text, p_license_note text)` | `TABLE(outcome text, asset_id uuid, storage_key text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_cmd_rollback(p_token_hash bytea, p_request_id uuid, p_new_version_id uuid, p_target_id uuid, p_contrast_check jsonb)` | `TABLE(outcome text, version_id uuid, version_no integer, copied_from_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_cmd_save_draft(p_token_hash bytea, p_request_id uuid, p_version_id uuid, p_brand_name text, p_tokens jsonb, p_tokens_schema_version integer, p_logo_asset_id uuid, p_favicon_asset_id uuid, p_pwa_icon_asset_id uuid, p_copied_from_id uuid)` | `TABLE(outcome text, version_id uuid, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_staff_versions(p_token_hash bytea, p_version_id uuid, p_limit integer)` | `TABLE(id uuid, version_no integer, status text, brand_name text, tokens jsonb, tokens_schema_version integer, logo_asset_id uuid, favicon_asset_id uuid, pwa_icon_asset_id uuid, contrast_check jsonb, copied_from_id uuid, created_by uuid, created_at timestamp with time zone, published_by uuid, published_at timestamp with time zone, archived_at timestamp with time zone, tokens_sha256 text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_content_cmd_publish(p_token_hash bytea, p_request_id uuid, p_block_key text, p_country text, p_version_no integer)` | `TABLE(outcome text, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_content_cmd_rollback(p_token_hash bytea, p_request_id uuid, p_block_key text, p_country text, p_target_version_no integer)` | `TABLE(outcome text, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_content_cmd_save_draft(p_token_hash bytea, p_request_id uuid, p_block_key text, p_country text, p_bodies jsonb, p_asset_id uuid)` | `TABLE(outcome text, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_claim_view(p_claim_id uuid)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_cmd_accept_incidental(p_token_hash bytea, p_invoice_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_attach_incidental_file(p_token_hash bytea, p_trip_id uuid, p_file_id uuid, p_mime text, p_bytes bigint, p_sha256 bytea)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_cancel_incidental(p_token_hash bytea, p_invoice_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_charge_incidental(p_invoice_id uuid, p_charge_id uuid)` | `TABLE(outcome text, code text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_decide_incidental(p_invoice_id uuid, p_agent uuid, p_role text, p_request_id uuid, p_outcome text, p_rationale text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_cmd_defer_decision(p_decision_id uuid, p_code text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_defer_incidental(p_invoice_id uuid, p_code text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_dispute_incidental(p_token_hash bytea, p_invoice_id uuid, p_reason text, p_evidence uuid[])` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_execute_decision(p_decision_id uuid, p_charge_id uuid)` | `TABLE(outcome text, code text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_issue_decision(p_decision_id uuid, p_claim_id uuid, p_agent uuid, p_role text, p_request_id uuid, p_input jsonb, p_preview boolean)` | `TABLE(outcome text, decision_id uuid, body jsonb)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_cmd_record_claim(p_claim_id uuid, p_trip_id uuid, p_case_id uuid, p_declared_by text, p_kind text, p_description text, p_agent uuid, p_role text, p_request_id uuid)` | `TABLE(outcome text, claim_id uuid, deadline_at timestamp with time zone)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_cmd_record_insurer_declaration(p_declaration_id uuid, p_provider_ref text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_cmd_submit_incidental(p_token_hash bytea, p_trip_id uuid, p_request_id uuid, p_fee_type text, p_amount_minor bigint, p_description text, p_evidence uuid[])` | `TABLE(outcome text, invoice_id uuid, response_due_at timestamp with time zone)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_decisions_due(p_limit integer)` | `TABLE(decision_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_evidence_export_file(p_bundle_id uuid)` | `TABLE(file_id uuid, storage_key text, sha256 text, bytes bigint, enc_subject_id uuid)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_evidence_record(p_trip_id uuid, p_country text, p_case_id uuid, p_purpose text, p_requested_by uuid, p_requested_role text, p_request_id uuid)` | `TABLE(outcome text, bundle_id uuid, status text, manifest_sha256 text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_incidental_host_files(p_trip_id uuid, p_user uuid)` | `TABLE(file_id uuid)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_incidental_invoices_due(p_limit integer, p_only uuid[])` | `TABLE(invoice_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_incidental_review_list(p_countries text[])` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_incidental_staff_view(p_invoice_id uuid)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.claim_incidental_store_host_file(p_trip_id uuid, p_user uuid, p_file_id uuid, p_mime text, p_bytes bigint, p_sha256 bytea)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_incidental_trip_facts(p_trip_id uuid)` | `TABLE(trip_id uuid, country_code text, currency text, org_id uuid, guest_user_id uuid, holder_user_id uuid, status text, timezone text, start_at timestamp with time zone, end_at timestamp with time zone, terminated_early boolean, fuel_out smallint, fuel_in smallint, extras_sold boolean)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_incidental_trip_photos(p_trip_id uuid)` | `TABLE(file_id uuid, kind text, slot_code text, slot_group text, taken_by_role text, received_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_incidental_view(p_token_hash bytea, p_trip_id uuid)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_insurer_declarations_due(p_limit integer)` | `TABLE(declaration_id uuid, claim_id uuid, country_code text, currency text, kind text, repair_cost_minor bigint, reported_at timestamp with time zone)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_trip_facts(p_trip_id uuid)` | `TABLE(trip_id uuid, country_code text, currency text, org_id uuid, guest_user_id uuid, holder_user_id uuid, status text, end_at timestamp with time zone, window_hours integer, deadline_at timestamp with time zone, checkin_photos boolean, checkout_photos boolean, accepted_deductible_minor bigint)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.claim_worker_complete_evidence_bundle(p_bundle_id uuid, p_file_id uuid, p_storage_key text, p_sha256 bytea, p_bytes bigint)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.claim_worker_evidence_due(p_limit integer)` | `TABLE(bundle_id uuid)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.claim_worker_evidence_source(p_bundle_id uuid)` | `TABLE(outcome text, manifest text, manifest_sha256 text, requested_by uuid, contracts jsonb, messages text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.claim_worker_fail_evidence_bundle(p_bundle_id uuid, p_code text, p_findings jsonb)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.config_cmd_approve_go_live_switch(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text, request_id uuid)` | `cmd_golive_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_golive_owner: EXECUTE |
| `core.config_cmd_approve_param_change(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text, request_id uuid)` | `cmd_param_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_param_owner: EXECUTE |
| `core.config_cmd_cancel_go_live_switch(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text, request_id uuid)` | `cmd_golive_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_golive_owner: EXECUTE |
| `core.config_cmd_cancel_param_change(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text, request_id uuid)` | `cmd_param_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_param_owner: EXECUTE |
| `core.config_cmd_request_go_live_switch(p_token_hash bytea, p_request_id uuid, p_key text, p_country text, p_value boolean, p_decision_ref text)` | `TABLE(outcome text, request_id uuid)` | `cmd_golive_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_golive_owner: EXECUTE |
| `core.config_cmd_request_param_change(p_token_hash bytea, p_request_id uuid, p_key text, p_country text, p_value jsonb, p_currency text, p_valid_from timestamp with time zone, p_reason text, p_decision_ref text)` | `TABLE(outcome text, request_id uuid)` | `cmd_param_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_param_owner: EXECUTE |
| `core.ctr_checkout_terms(p_user_id uuid, p_country text, p_documents jsonb)` | `TABLE(outcome text, doc_kind text, doc_version integer, locale text, title text, template_id uuid, consent_id uuid)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_cmd_accept_documents(p_token_hash bytea, p_documents jsonb)` | `integer` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_cmd_accept_host_terms(p_token_hash bytea, p_org uuid, p_version integer, p_language text)` | `TABLE(outcome text, version integer)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_cmd_set_marketing(p_token_hash bytea, p_opt_in boolean)` | `text` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_consent_history(p_token_hash bytea)` | `TABLE(doc_kind text, doc_version integer, locale text, accepted boolean, accepted_at timestamp with time zone, context text)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_consent_status(p_token_hash bytea)` | `TABLE(doc_kind text, required boolean, current_version integer, required_version integer, accepted_version integer, accepted boolean, reaccept_required boolean)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_document_body(p_kind text, p_country text, p_language text, p_version integer)` | `TABLE(doc_kind text, version integer, is_major boolean, locale text, title text, body_md text, content_hash bytea, is_draft boolean, valid_from timestamp with time zone)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_host_terms(p_token_hash bytea, p_org uuid, p_language text)` | `TABLE(outcome text, country_code text, version integer, is_major boolean, locale text, title text, content_hash bytea, is_draft boolean, valid_from timestamp with time zone, required_version integer, accepted_version integer, accepted_at timestamp with time zone, reaccept_required boolean)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_host_terms_required(p_user_id uuid, p_country text)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; iam_auth_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.ctr_published_documents(p_country text, p_language text)` | `TABLE(doc_kind text, version integer, is_major boolean, locale text, title text, content_hash bytea, is_draft boolean, valid_from timestamp with time zone)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.ctr_signup_consents_guard()` | `trigger` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | iam_auth_owner: EXECUTE |
| `core.ctr_staff_cmd_publish_document(p_token_hash bytea, p_request_id uuid, p_kind text, p_country text, p_is_major boolean, p_valid_from timestamp with time zone, p_legal_review_ref text, p_bodies jsonb)` | `TABLE(outcome text, version integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_chargeback_facts()` | `TABLE(country_code text, imputed boolean, host_frozen boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.finance_earning_lines(p_org uuid)` | `TABLE(line_kind text, trip_id uuid, country_code text, currency text, period_month text, event_at timestamp with time zone, trip_status text, source text, settlement_version integer, reason text, amount_minor bigint, share_base_minor bigint, host_plan_code text, host_share_pct text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.finance_host_statement(p_org uuid, p_month text)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.finance_insurer_ledger_facts()` | `TABLE(country_code text, currency text, collected_entries_minor bigint, collected_legs_minor bigint, settled_entries_minor bigint, settled_variations_minor bigint, billed_minor bigint, due_minor bigint, unattributed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.finance_staff_reconciliation_export(p_token_hash bytea, p_request_id uuid, p_country text, p_month date, p_kind text, p_reason text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_staff_reconciliation_run(p_token_hash bytea, p_request_id uuid, p_run_id uuid, p_export boolean, p_reason text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_staff_reconciliation_runs(p_token_hash bytea, p_country text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_staff_record_reconciliation(p_token_hash bytea, p_request_id uuid, p_country text, p_month date, p_kind text, p_lines jsonb, p_reason text)` | `TABLE(outcome text, run_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_staff_resolve_reconciliation_item(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_resolution text, p_note text)` | `TABLE(outcome text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_staff_sign_reconciliation(p_token_hash bytea, p_request_id uuid, p_run_id uuid, p_checklist jsonb)` | `TABLE(outcome text, unexplained integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.finance_trip_leg_facts()` | `TABLE(trip_id uuid, country_code text, currency text, captured_minor bigint, collected_minor bigint, collected_legs_minor bigint, head_total_paid_minor bigint, expected_host_minor bigint, statement_host_minor bigint)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.finance_trip_receipt_view(p_trip_id uuid, p_viewer text)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.iam_auth_lookup(p_email text)` | `TABLE(user_id uuid, password_hash text, status text)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_open_host_account(p_token_hash bytea, p_country text, p_holder_kind text)` | `TABLE(outcome text, org_id uuid)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_open_session(p_session_id uuid, p_user_id uuid, p_token_hash bytea, p_ttl_s integer, p_mfa_level text, p_ip inet, p_user_agent text)` | `timestamp with time zone` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_phone_otp_request(p_token_hash bytea, p_phone text, p_country text)` | `TABLE(outcome text, challenge_id uuid, resend_after_s integer, expires_in_s integer, locked_for_s integer)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_phone_otp_verify(p_token_hash bytea, p_code_hashes bytea[])` | `TABLE(outcome text, attempts_left integer, locked_for_s integer)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_register(p_user_id uuid, p_email text, p_password_hash text, p_legal_first_name text, p_legal_last_name text, p_preferred_locale text, p_verification_id uuid, p_verification_token_hash bytea, p_verification_ttl_s integer, p_ip inet)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_register_with_consents(p_user_id uuid, p_email text, p_password_hash text, p_legal_first_name text, p_legal_last_name text, p_preferred_locale text, p_verification_id uuid, p_verification_token_hash bytea, p_verification_ttl_s integer, p_ip inet, p_country text, p_documents jsonb, p_marketing_opt_in boolean)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_revoke_all_sessions(p_token_hash bytea)` | `integer` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_revoke_session(p_token_hash bytea, p_reason text)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_verify_email(p_token_hash bytea)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_holder_name_matches(p_user_id uuid, p_first text, p_last text)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_host_accounts(p_token_hash bytea)` | `TABLE(org_id uuid, country_code text, role text, org_status text, display_name text)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; host_view_owner: EXECUTE ; iam_auth_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.iam_host_public_first_name(p_org uuid)` | `text` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_manual_action_create_host_account(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_manual_action_restriction(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_notification_contact(p_user_id uuid)` | `TABLE(email text, phone_e164 text, preferred_locale text, first_name text)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_phone_otp_state(p_token_hash bytea)` | `TABLE(outcome text, verified_phone text, pending_phone text, resend_after_s integer, expires_in_s integer, locked_for_s integer, attempts_left integer)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_session_resolve(p_token_hash bytea)` | `TABLE(session_id uuid, user_id uuid, mfa_level text, expires_at timestamp with time zone, email_verified boolean)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; messaging_cmd_owner: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.iam_staff_audit_read(p_token_hash bytea, p_before_id bigint, p_limit integer)` | `TABLE(id bigint, at timestamp with time zone, actor_user_id uuid, actor_role text, action_code text, subject_type text, subject_id uuid, reason text, before jsonb, after jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_begin(p_token_hash bytea)` | `TABLE(outcome text, user_id uuid, factor_id uuid, roles jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_data_access(p_token_hash bytea, p_request_id uuid, p_case_id uuid, p_subject_type text, p_subject_id uuid, p_field_or_file text, p_access_kind text, p_purpose text)` | `TABLE(outcome text, access_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_elevate(p_token_hash bytea, p_factor_id uuid, p_step bigint, p_proof bytea)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_enroll_reveal(p_token_hash bytea, p_code_hash bytea)` | `TABLE(outcome text, factor_id uuid, secret_ref text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid, p_action_code text, p_subject_id uuid, p_reason text, p_input jsonb)` | `TABLE(outcome text, action_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid, p_action_code text, p_subject_id uuid, p_reason text, p_input jsonb, p_evidence uuid[])` | `TABLE(outcome text, action_id uuid, domain_ref uuid, detail text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_mfa_attempt(p_token_hash bytea)` | `TABLE(outcome text, factor_id uuid, secret_ref text, last_used_step bigint)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_reset_totp(p_token_hash bytea, p_request_id uuid, p_target uuid, p_reason text, p_factor_id uuid, p_secret_ref text, p_code_hash bytea, p_ttl_s integer)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_suspend(p_token_hash bytea, p_request_id uuid, p_target uuid, p_reason text)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_read_access(p_token_hash bytea, p_permission text, p_scope text)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_worker_otp_issue(p_challenge_id uuid, p_code_hash bytea)` | `TABLE(outcome text, phone_e164 text, country_code text, locale text, expires_in_min integer)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_worker_otp_prune(p_batch integer)` | `integer` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.kyc_checkout_driver(p_user uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_country text, p_min_age integer)` | `TABLE(outcome text, foreign_signal text, account_created_at timestamp with time zone)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_apply_decision(p_provider text, p_event_id text, p_session_ref text, p_subject_ref text, p_decision text, p_liveness numeric, p_face_match numeric, p_document jsonb)` | `TABLE(outcome text, status text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_biometric_consent(p_token_hash bytea, p_country text, p_version integer, p_accepted boolean)` | `TABLE(outcome text, version integer)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_change_legal_name(p_token_hash bytea, p_first text, p_last text)` | `TABLE(outcome text, status text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_decide_with_facts(p_provider text, p_event_id text, p_session_ref text, p_subject_ref text, p_decision text, p_liveness numeric, p_face_match numeric, p_document jsonb, p_subject jsonb)` | `TABLE(outcome text, status text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_declare_entry(p_token_hash bytea, p_country text, p_residency text, p_entry_date date)` | `TABLE(outcome text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_host_record_screening(p_token_hash bytea, p_org uuid, p_provider text, p_request_key text, p_result text, p_lists_version jsonb, p_match_ref text)` | `TABLE(outcome text, status text, missing text[])` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_host_save_tax_profile(p_token_hash bytea, p_org uuid, p_kind text, p_tax_id_enc bytea, p_regime text, p_taxpayer_kind text)` | `TABLE(outcome text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_host_submit(p_token_hash bytea, p_org uuid)` | `TABLE(outcome text, verification_id uuid, status text, missing text[], screening_key text, identity_provider text, identity_session_ref text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_open_verification(p_token_hash bytea, p_country text, p_provider text)` | `TABLE(outcome text, verification_id uuid, attempt integer, hosted_url text, session_expires_at timestamp with time zone)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_record_erasure(p_token_hash bytea, p_request_id uuid, p_outcome text, p_attestation_ref text)` | `TABLE(outcome text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_record_session(p_token_hash bytea, p_verification_id uuid, p_attempt integer, p_provider text, p_session_ref text, p_hosted_url text, p_expires_at timestamp with time zone)` | `TABLE(outcome text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_record_webhook_rejection(p_provider text, p_reason text, p_body_sha256 bytea, p_body_length integer)` | `void` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_cmd_retry_erasure(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_consent_withdrawn(p_user uuid)` | `boolean` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_country_of_verification(p_id uuid)` | `text` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_driver_eligibility(p_token_hash bytea, p_trip_end timestamp with time zone, p_trip_country text)` | `TABLE(outcome text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_host_identity_duplicate(p_org uuid)` | `boolean` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | kyc_cmd_owner: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.kyc_host_payout_identity(p_org uuid, p_holder_given text, p_holder_surnames text)` | `TABLE(kyc_approved boolean, name_match text, tax_id_kind text, tax_id_enc bytea)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_host_state(p_token_hash bytea, p_org uuid)` | `TABLE(outcome text, country_code text, org_status text, verification_status text, missing text[], kyc_approved boolean, age_status text, residence_status text, tax_required boolean, tax_saved boolean, tax_kind text, tax_kinds text[], terms_ok boolean, screening_done boolean, blockers text[])` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_identity_state(p_token_hash bytea, p_country text)` | `TABLE(outcome text, status text, country_code text, reason_code text, license_expires_on date, session_live boolean, phone_verified boolean, consent_version integer, consent_accepted_version integer, consent_locale text, consent_title text, consent_body text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_manual_action_decision(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_manual_action_host_sanctions_screening(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_manual_action_host_screening_review(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_manual_action_host_verification_decision(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_pending_erasures(p_token_hash bytea)` | `TABLE(request_id uuid, provider text, session_ref text)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_staff_dossier(p_user uuid)` | `jsonb` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_staff_entry_declaration(p_user uuid, p_country text)` | `jsonb` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_staff_host_dossier(p_org uuid)` | `jsonb` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_staff_status(p_user uuid)` | `text` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_verification_review_queue()` | `trigger` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | kyc_cmd_owner: EXECUTE |
| `core.kyc_worker_auto_review_hosts(p_batch integer, p_org uuid)` | `TABLE(approved integer, kept integer, skipped integer, failed integer)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_worker_enqueue_reviews(p_batch integer)` | `TABLE(enqueued integer, unqueued integer, waiting integer, skipped integer)` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.kyc_worker_prune(p_batch integer)` | `integer` | `kyc_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.messaging_cmd_answer_meeting(p_token_hash bytea, p_trip_id uuid, p_meeting_id uuid, p_decision text)` | `TABLE(outcome text, meeting_id uuid, kind text, meet_at timestamp with time zone, status text)` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.messaging_cmd_post_message(p_token_hash bytea, p_trip_id uuid, p_message_id uuid, p_body text)` | `TABLE(outcome text, message_id uuid, body text, masked boolean, off_platform boolean, sent_at timestamp with time zone)` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.messaging_cmd_propose_meeting(p_token_hash bytea, p_trip_id uuid, p_meeting_id uuid, p_kind text, p_place text, p_meet_at timestamp with time zone)` | `TABLE(outcome text, meeting_id uuid, kind text, place_label text, meet_at timestamp with time zone, status text)` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.messaging_evidence_messages(p_trip_id uuid, p_until timestamp with time zone)` | `TABLE(thread_id uuid, document text, message_count integer, flagged_count integer)` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.messaging_mask_text(p_text text, OUT masked text, OUT kinds text[])` | `record` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | messaging_cmd_owner: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.messaging_meeting_read(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, viewer_role text, can_propose boolean, timezone text, meeting_id uuid, kind text, place_label text, meet_at timestamp with time zone, status text, mine boolean, created_at timestamp with time zone, answered_at timestamp with time zone)` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.messaging_thread_read(p_token_hash bytea, p_trip_id uuid, p_limit integer)` | `TABLE(outcome text, viewer_role text, counterpart_name text, writable boolean, closes_at timestamp with time zone, timezone text, message_id uuid, mine boolean, author_role text, author_name text, body text, masked boolean, off_platform boolean, sent_at timestamp with time zone, purged boolean)` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.messaging_wait_traced(p_trip_id uuid, p_side text, p_from timestamp with time zone, p_at timestamp with time zone, p_wait interval)` | `boolean` | `messaging_cmd_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.payment_assert_operation_legs()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.payment_assert_payout_adjustment(p_account_id uuid, p_method text)` | `void` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_accept_mit_consent(p_token_hash bytea, p_hold_id uuid, p_locale text, p_catalog_version integer)` | `TABLE(outcome text, consent_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_ack_mit_reminder(p_token_hash bytea, p_trip_id uuid, p_locale text, p_catalog_version integer)` | `TABLE(outcome text, acknowledged_at timestamp with time zone)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_apply_operation_status(p_operation_id uuid, p_status text, p_source text, p_raw_ref uuid, p_provider_reference text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_defer_mit_charge(p_charge_id uuid, p_code text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_deposit_decide(p_deposit_id uuid, p_expected_seq integer, p_status text, p_captured_minor bigint, p_released_minor bigint)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.payment_cmd_deposit_transition(p_deposit_id uuid, p_event text, p_expected_seq integer, p_auth_expiry_at timestamp with time zone, p_decision_at timestamp with time zone, p_reauth_due_at timestamp with time zone, p_provider_reference text)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.payment_cmd_notify_post_trip_charge(p_id uuid, p_trip_id uuid, p_purpose text, p_reason text, p_origin_type text, p_origin_id uuid, p_settlement_version integer, p_tender_operation_id uuid, p_amount_minor bigint, p_legs jsonb, p_guest_agreed boolean)` | `TABLE(outcome text, charge_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_plan_debt_collection(p_debt_id uuid, p_collection_id uuid, p_operation_id uuid, p_amount_minor bigint)` | `TABLE(outcome text, collection_id uuid, operation_id uuid, legs jsonb)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_plan_mit_attempt(p_charge_id uuid, p_operation_id uuid)` | `TABLE(outcome text, code text, operation_id uuid, attempt integer)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_plan_refund(p_instance_id uuid, p_operation_id uuid, p_settlement_id uuid, p_refunded_operation_id uuid, p_instance_seq integer, p_rail text, p_legs jsonb, p_idem_plain text, p_idem_sent text)` | `TABLE(instance_id uuid, operation_id uuid, advance_id uuid, status text, blocked_reason text, replayed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_receive_webhook(p_account_id uuid, p_provider_event_id text, p_dedup_key bytea, p_signature_valid boolean, p_signed_at timestamp with time zone, p_headers jsonb, p_normalized jsonb)` | `TABLE(outcome text, inbox_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_record_deposit_decision(p_token_hash bytea, p_hold_id uuid, p_decision jsonb)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.payment_cmd_record_instrument(p_id uuid, p_hold_id uuid, p_psp_account_id uuid, p_token_ref text, p_network text, p_funding text, p_last4 text, p_exp_month integer, p_exp_year integer, p_network_tx_reference text, p_transaction_link_id text)` | `TABLE(instrument_id uuid, bound boolean, replayed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_record_operation(p_id uuid, p_hold_id uuid, p_trip_id uuid, p_psp_account_id uuid, p_method text, p_kind text, p_purpose text, p_amount_minor bigint, p_currency text, p_attempt_no integer, p_idem_plain text, p_idem_sent text, p_legs jsonb, p_settlement_id uuid, p_settlement_version integer)` | `TABLE(operation_id uuid, replayed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_record_submerchant_status(p_submerchant_id uuid, p_status text, p_provider_ref text, p_reason text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_refund_await_choice(p_instance_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_refund_mark_alerted(p_instance_id uuid, p_key text)` | `boolean` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_refund_order_for_send(p_instance_id uuid)` | `TABLE(operation_id uuid, operation_status text, idem_sent text, amount_minor bigint, currency text, legs jsonb, target_reference text, provider_reference text, provider text, sendable boolean, reason text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_register_submerchant(p_id uuid, p_org_id uuid, p_psp_account_id uuid, p_attempt_no integer)` | `TABLE(submerchant_id uuid, idem_plain text, replayed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_settle_debt_collection(p_collection_id uuid)` | `TABLE(outcome text, debt_status text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_settle_mit_attempt(p_charge_id uuid, p_do_not_retry boolean)` | `TABLE(outcome text, code text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_submit_refund(p_instance_id uuid)` | `TABLE(outcome text, blocked_reason text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_deposit_checkout(p_token_hash bytea, p_hold_id uuid)` | `TABLE(outcome text, country_code text, currency text, value_class text, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, provider text, now timestamp with time zone, mechanism text, amount_minor bigint, release_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.payment_deposit_decision_due(p_limit integer)` | `TABLE(deposit_id uuid, trip_id uuid, segment_id uuid, tender_id uuid, country_code text, currency text, provider text, provider_reference text, mechanism text, amount_minor bigint, decision_at timestamp with time zone, auth_expiry_at timestamp with time zone, reauth_seq integer, now timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.payment_deposit_reauth_due(p_limit integer)` | `TABLE(deposit_id uuid, trip_id uuid, segment_id uuid, tender_id uuid, country_code text, currency text, provider text, provider_reference text, auth_expiry_at timestamp with time zone, release_at timestamp with time zone, reauth_seq integer, now timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.payment_mit_attempt_for_send(p_charge_id uuid)` | `TABLE(sendable boolean, operation_id uuid, operation_status text, idem_sent text, amount_minor bigint, currency text, legs jsonb, provider_reference text, instrument_token text, mit_reason text, provider text, attempt integer)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_mit_consent_mode_of_hold(p_token_hash bytea, p_hold_id uuid)` | `TABLE(mode text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_mit_consent_view(p_token_hash bytea, p_trip_id uuid)` | `TABLE(consented boolean, accepted_at timestamp with time zone, network text, last4 text, card_active boolean, reminded_at timestamp with time zone)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_operation_mit_guard()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.payment_post_trip_charges_due(p_limit integer)` | `TABLE(charge_id uuid, status text, provider text, country_code text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_refund_instance_gate()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.payment_refund_instance_sync()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.payment_refunds_due(p_limit integer)` | `TABLE(instance_id uuid, country_code text, status text, operation_status text, provider text, blocked_reason text, fin_alert text, target_known boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_resolve_webhook_account(p_provider text, p_public_webhook_id text)` | `TABLE(account_id uuid, webhook_secret_ref text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_startup_guard()` | `TABLE(deployment_env text, fake_accounts integer)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_trip_refund_view(p_trip_id uuid, p_viewer text)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.payout_batches_due(p_limit integer)` | `TABLE(batch_id uuid, step text, status text, country_code text, currency text, provider text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_adjustment(p_batch_id uuid)` | `TABLE(outcome text, idempotency_key text, amount_minor bigint, currency text, submerchant_reference text, provider_ref text, hold_reasons text[])` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_defer_trip(p_trip_id uuid, p_outcome text)` | `timestamp with time zone` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_initiate_batch(p_batch_id uuid)` | `TABLE(outcome text, idempotency_key text, amount_minor bigint, currency text, submerchant_reference text, provider_ref text, hold_reasons text[])` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_net_batch(p_batch_id uuid)` | `TABLE(outcome text, gross_minor bigint, netted_minor bigint, net_minor bigint, hold_reasons text[])` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_prepare_trip(p_trip_id uuid)` | `TABLE(outcome text, batch_id uuid, payout_at timestamp with time zone, status text, hold_reasons text[])` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_recheck_batch(p_batch_id uuid)` | `TABLE(outcome text, hold_reasons text[])` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_record_adjustment(p_batch_id uuid, p_status text, p_provider_ref text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_record_payout_account_verification(p_token_hash bytea, p_org uuid, p_account uuid, p_status text, p_reason text, p_provider_ref text)` | `TABLE(outcome text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_record_payout_result(p_batch_id uuid, p_status text, p_provider_ref text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_cmd_register_payout_account(p_token_hash bytea, p_org uuid, p_rail_kind text, p_institution text, p_account_enc bytea, p_account_last4 text, p_holder_given text, p_holder_surnames text)` | `TABLE(outcome text, account_id uuid, change_hold_until timestamp with time zone)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_host_payouts(p_token_hash bytea, p_org uuid)` | `TABLE(outcome text, country_code text, currency text, schedule jsonb, batches jsonb)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_payout_account_context(p_token_hash bytea, p_org uuid, p_holder_given text, p_holder_surnames text)` | `TABLE(outcome text, country_code text, currency text, rails jsonb, tax_kind text, tax_id_enc bytea)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_payout_account_hold(p_org uuid, p_currency text, p_scheduled_for timestamp with time zone)` | `text[]` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_payout_account_state(p_token_hash bytea, p_org uuid)` | `TABLE(outcome text, country_code text, currency text, rails jsonb, tax_kind text, account_id uuid, status text, rail_kind text, institution_code text, account_last4 text, change_hold_until timestamp with time zone, reject_reason text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_release_hold_reasons(p_trip_id uuid)` | `text[]` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.payout_release_item_guard()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.payout_release_items(p_batch_id uuid)` | `TABLE(item_id uuid, trip_id uuid, amount_minor bigint, currency text, psp_account_id uuid, next_attempt integer, next_key text, operation_id uuid, operation_status text, idem_sent text, provider_reference text, applied boolean, beneficiary_reference text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payout_trips_to_prepare(p_limit integer)` | `TABLE(trip_id uuid, country_code text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.pricing_bind_checkout_trip(p_trip_id uuid)` | `integer` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.pricing_checkout_terms(p_token_hash bytea, p_quote_id uuid)` | `TABLE(quote_id uuid, engine_version text, inputs text, inputs_hash text, outputs text, outputs_hash text, total_minor bigint, currency text, frozen_at timestamp with time zone, mileage_mode text, included_km integer, extra_km_price_minor bigint)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.pricing_cmd_freeze_quote(p_token_hash bytea, p_listing_id uuid, p_inputs text, p_inputs_hash text, p_outputs text, p_outputs_hash text)` | `TABLE(outcome text, quote_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.pricing_cmd_version_trip_price(p_token_hash bytea, p_trip_id uuid, p_quote_id uuid)` | `TABLE(outcome text, version integer)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.privacy_kyc_register_gate(p_country text)` | `text` | `privacy_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.privacy_manual_action_dsr(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `privacy_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.privacy_worker_dsr_overdue(p_batch integer)` | `TABLE(country_code text, overdue integer)` | `privacy_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.privacy_worker_message_purge(p_batch integer)` | `integer` | `privacy_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.privacy_worker_retention_sweep(p_batch integer)` | `integer` | `privacy_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.privacy_worker_stale_kyc_erasures(p_after_minutes integer)` | `integer` | `privacy_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.report_staff_beta_view(p_token_hash bytea, p_request_id uuid, p_view text, p_country text, p_export boolean, p_reason text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.review_cmd_submit(p_token_hash bytea, p_trip_id uuid, p_overall integer, p_sub_scores jsonb, p_text text)` | `TABLE(outcome text, status text, submitted_at timestamp with time zone, published_at timestamp with time zone)` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.review_listing_host_profile(p_listing_id uuid)` | `TABLE(outcome text, view jsonb)` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.review_listing_ratings(p_listing_ids uuid[])` | `TABLE(listing_id uuid, vehicle_trip_count integer, vehicle_review_count integer, vehicle_avg_x100 integer, host_trip_count integer, host_review_count integer, host_avg_x100 integer)` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.review_manual_action_record_review(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | iam_staff_owner: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.review_my_received(p_token_hash bytea)` | `TABLE(outcome text, view jsonb)` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.review_trip_read(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, view jsonb)` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.review_worker_publish_due(p_batch integer)` | `integer` | `review_cmd_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; review_cmd_owner: EXECUTE |
| `core.risk_cmd_hit(p_scope text, p_key_hash bytea, p_country text, p_limit integer, p_window_s integer, p_weight integer)` | `TABLE(allowed boolean, hits integer, retry_after_s integer)` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_cmd_prune(p_batch integer, p_event_retention_days integer)` | `integer` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_cmd_record_abuse(p_kind text, p_scope text, p_key_hash bytea, p_country text, p_signals text[])` | `void` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_cmd_sms_reserve(p_country text, p_cap integer, p_critical boolean)` | `TABLE(allowed boolean, sent_today integer, alert boolean)` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; app_worker: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_self_booking_signal(p_guest uuid, p_org uuid)` | `text` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_staff_abuse_board(p_token_hash bytea, p_country text, p_hours integer)` | `TABLE(kind text, scope text, country_code text, bucket_start timestamp with time zone, occurrences bigint, distinct_keys bigint, signals text[], last_at timestamp with time zone)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.risk_staff_decide_account_link(p_token_hash bytea, p_request_id uuid, p_user_a uuid, p_user_b uuid, p_decision text, p_signal text)` | `TABLE(outcome text, link_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.security_incident_cmd_open(p_token_hash bytea, p_request_id uuid, p_country text, p_kind text, p_severity text, p_personal_data boolean, p_subjects_estimate integer, p_detected_at timestamp with time zone)` | `TABLE(outcome text, incident_id uuid, authority_due_at timestamp with time zone, subjects_due_at timestamp with time zone)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.security_incident_cmd_step(p_token_hash bytea, p_request_id uuid, p_incident_id uuid, p_step text, p_postmortem_file_id uuid)` | `TABLE(outcome text, incident_id uuid, status text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.security_incident_worker_watch(p_batch integer)` | `TABLE(signal text, country_code text, n integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.settlement_advance_approvers(p_token_hash bytea, p_advance_id uuid)` | `TABLE(decided_by uuid, decision_second_by uuid, written_off_by uuid, write_off_second_by uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_advance_ledger_projected()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_assert_balanced()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_assert_cancellation_refunded()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_cancellation_of(p_settlement_id uuid)` | `TABLE(id uuid, trip_id uuid, segment_no integer, version integer, supersedes_id uuid, kind text, requested_reason text, reason text, origin text, target_state text, inputs jsonb, superseded boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_apply_conversion_capture(p_operation_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_apply_leg_movement(p_operation_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_approve_finance_action(p_token_hash bytea, p_approval_id uuid)` | `TABLE(outcome text, approval_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_draft_insurer_bordereaux(p_month text)` | `TABLE(outcome text, country text, bordereau uuid, lines integer, total bigint)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_impute_chargeback(p_operation_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_cmd_post_advance_receivable(p_advance_id uuid)` | `uuid` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_cmd_post_host_penalty(p_settlement_id uuid)` | `uuid` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_cmd_record(p_settlement_id uuid, p_trip_id uuid, p_segment_no integer, p_version integer, p_supersedes_id uuid, p_trip_row_version integer, p_record jsonb)` | `uuid` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_request_finance_action(p_token_hash bytea, p_request_id uuid, p_action text, p_subject_id uuid, p_reason text)` | `TABLE(outcome text, approval_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_freeze_host_on_chargeback()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_host_ledger_state_projected()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_post_advance_receivable()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_post_cancellation_penalty()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_post_insurer_collection()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_post_insurer_variation()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_refresh_host_ledger_state(p_org_id uuid, p_currency text)` | `void` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_release_chargeback_freeze(p_trip_id uuid)` | `integer` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_staff_cancellation_summary(p_settlement_id uuid)` | `jsonb` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_close_review_item(p_item_id uuid, p_status text, p_decision text, p_actor uuid)` | `TABLE(outcome text, item_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE |
| `core.support_cmd_open_help_request(p_token_hash bytea, p_request_id uuid, p_trip_id uuid, p_topic text, p_support_hours jsonb)` | `TABLE(outcome text, case_id uuid, off_hours boolean, requester_role text, country_code text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_enqueue_review(p_queue text, p_subject_type text, p_subject_id uuid, p_country text, p_actor uuid)` | `TABLE(outcome text, item_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.support_manual_action_finance_request(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_add_note(p_token_hash bytea, p_request_id uuid, p_user_id uuid, p_body text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_booking_review(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_catalog_addition(p_token_hash bytea, p_request_id uuid, p_item_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_claim(p_token_hash bytea, p_request_id uuid, p_claim_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_claim_item(p_token_hash bytea, p_request_id uuid, p_item_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_conflict(p_actor uuid, p_subject_type text, p_subject_id uuid)` | `boolean` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | cmd_golive_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_decide_incidental(p_token_hash bytea, p_request_id uuid, p_invoice_id uuid, p_outcome text, p_rationale text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_decide_listing(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_decision text, p_reason text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_decide_vehicle_claim(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_decision text, p_reason text, p_checklist jsonb, p_note text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_decide_vehicle_eligibility(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_checklist jsonb, p_documents jsonb)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_evidence_bundle(p_token_hash bytea, p_request_id uuid, p_bundle_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_evidence_permitted(p_token_hash bytea, p_request_id uuid, p_subject_user uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_find_user(p_token_hash bytea, p_request_id uuid, p_email text, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_help_requests(p_token_hash bytea, p_country text, p_limit integer)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_host_dossier(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_incidental(p_token_hash bytea, p_request_id uuid, p_invoice_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_incidental_review(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_issue_decision(p_token_hash bytea, p_request_id uuid, p_claim_id uuid, p_input jsonb, p_preview boolean)` | `TABLE(outcome text, decision_id uuid, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_kyc_dossier(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_open_case(p_token_hash bytea, p_request_id uuid, p_requester uuid, p_category text, p_priority text, p_channel text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_open_evidence_bundle(p_token_hash bytea, p_request_id uuid, p_bundle_id uuid, p_reason text)` | `TABLE(outcome text, file_id uuid, storage_key text, sha256 text, bytes bigint, manifest_sha256 text, trip_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_overdue_board(p_token_hash bytea, p_request_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_profile(p_token_hash bytea, p_request_id uuid, p_user_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_queues(p_token_hash bytea, p_queue text, p_limit integer)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_record_claim(p_token_hash bytea, p_request_id uuid, p_trip_id uuid, p_case_id uuid, p_declared_by text, p_kind text, p_description text)` | `TABLE(outcome text, claim_id uuid, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_record_evidence(p_token_hash bytea, p_request_id uuid, p_subject_user uuid, p_mime text, p_bytes bigint, p_sha256 bytea)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_request_evidence_bundle(p_token_hash bytea, p_request_id uuid, p_trip_id uuid, p_case_id uuid, p_purpose text, p_reason text)` | `TABLE(outcome text, bundle_id uuid, status text, manifest_sha256 text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_resolve_catalog_addition(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_decision text, p_variant_id uuid, p_entry jsonb, p_reject_reason text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_set_case_status(p_token_hash bytea, p_request_id uuid, p_case_id uuid, p_status text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_trip_cancellation(p_token_hash bytea, p_request_id uuid, p_trip_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_trip_refunds(p_token_hash bytea, p_request_id uuid, p_trip_id uuid)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_vehicle_claim(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_vehicle_eligibility(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_staff_vehicle_file(p_token_hash bytea, p_request_id uuid, p_item_id uuid, p_subject_type text, p_file_id uuid, p_purpose text)` | `TABLE(outcome text, body jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_trip_help_context(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, requester_role text, country_code text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.support_worker_review_sla(p_batch integer)` | `TABLE(queue text, country_code text, breached integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.trip_cmd_add_inspection_photo(p_token_hash bytea, p_trip_id uuid, p_kind text, p_capture_id uuid, p_slot text, p_file_id uuid, p_mime text, p_bytes bigint, p_sha256 bytea, p_device_captured_at timestamp with time zone)` | `TABLE(outcome text, storage_key text, received_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_detect_overdue(p_trip_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_identity_check(p_token_hash bytea, p_trip_id uuid, p_checklist jsonb, p_subreason text)` | `TABLE(outcome text, status text, checked_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_open_checkin(p_token_hash bytea, p_trip_id uuid)` | `TABLE(outcome text, opened_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_open_photo_capture(p_token_hash bytea, p_trip_id uuid, p_kind text, p_slot text)` | `TABLE(outcome text, capture_id uuid, expires_at timestamp with time zone)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_report_no_show(p_token_hash bytea, p_trip_id uuid, p_request_id uuid)` | `TABLE(outcome text, declaration_id uuid, requested_at timestamp with time zone, status text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_submit_inspection(p_token_hash bytea, p_trip_id uuid, p_kind text)` | `TABLE(outcome text, submitted_at timestamp with time zone, missing text[])` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_cmd_validate_handover(p_token_hash bytea, p_trip_id uuid, p_kind text, p_odometer_km integer, p_fuel_eighths integer, p_method text)` | `TABLE(outcome text, validated_at timestamp with time zone, completed_at timestamp with time zone, trip_status text)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_handover_view(p_token_hash bytea, p_trip_id uuid, p_kind text)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_inspection_view(p_token_hash bytea, p_trip_id uuid, p_kind text)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_manual_action_escalate_overdue(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, ref_id uuid, emitted_event_ids uuid[])` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.trip_no_show_view(p_token_hash bytea, p_trip_id uuid)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_overdue_board(p_countries text[])` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | cmd_hold_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.trip_overdue_due(p_batch integer)` | `TABLE(trip_id uuid)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.trip_photo_capture_check(p_token_hash bytea, p_trip_id uuid, p_kind text, p_capture_id uuid, p_slot text)` | `TABLE(outcome text, max_kb integer, max_px integer)` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `platform.declared_environment()` | `text` | `guard_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE |
| `platform.guest_hold_guard(p_period tstzrange)` | `TABLE(live_holds integer, trip_overlap boolean)` | `guard_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE ; guard_owner: EXECUTE |

## Autres fonctions

| Fonction | Résultat | Propriétaire | EXECUTE |
| -------- | -------- | ------------ | ------- |
| `app.actor_id()` | `uuid` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.actor_kind()` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; catalog_probe_owner: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; guard_owner: EXECUTE ; host_view_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.country_scope()` | `text[]` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.org_id()` | `uuid` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; host_view_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.session_token_hash()` | `bytea` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.vehicle_scope()` | `uuid[]` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.worker_name()` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; catalog_probe_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `core.audit_append_only()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.audit_canon(v text)` | `text` | `migrator` | audit_chain_owner: EXECUTE ; migrator: EXECUTE |
| `core.audit_chain_head_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.audit_destroy_subject_key(p_subject_type text, p_subject_id uuid, p_request_id uuid, p_reason text)` | `bigint` | `migrator` | migrator: EXECUTE |
| `core.audit_file_asset_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.audit_log_canonical(r core.audit_audit_log)` | `text` | `migrator` | audit_chain_owner: EXECUTE ; migrator: EXECUTE |
| `core.audit_subject_key_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_buffer_minutes(p_country text)` | `integer` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_cancellation_cost_bearer(p_reason text)` | `text` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_cancellation_params(p_country text, p_currency text)` | `jsonb` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_cancellation_target(p_reason text)` | `text` | `migrator` | cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_checkout_record_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_checkout_record_risk(p_hold uuid, p_guest uuid, p_org uuid, p_country text, p_rules jsonb, p_score integer, p_flagged boolean)` | `void` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_checkout_risk(p_guest uuid, p_vehicle uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_country text)` | `TABLE(outcome text, flagged boolean, rules jsonb, score integer)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_contract_courtesy_locale(p_guest uuid)` | `text` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_contract_facts(p_trip_id uuid)` | `jsonb` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_contract_template(p_country text, p_locale text)` | `TABLE(id uuid, version integer, locale text, title text, body_md text, is_draft boolean)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_conversion_due(p_limit integer)` | `TABLE(operation_id uuid, action text)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_convert_payment(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_disposition_candidates(p_limit integer)` | `TABLE(operation_id uuid, success_known_at timestamp with time zone)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_disposition_repair(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_epoch_ms(p_at timestamp with time zone)` | `bigint` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_expire_due_holds(p_limit integer)` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_guest_eligibility(p_hold_id uuid)` | `text` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_hold_guarded_columns()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_hold_payment_terms(p_hold_id uuid)` | `TABLE(amount_minor bigint, currency text, legs jsonb, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, timezone text)` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_hold_review_lapse()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_hold_terminal_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_intents_due(p_limit integer)` | `TABLE(operation_id uuid, hold_id uuid, provider text, method text, country_code text, psp_account_id uuid, idem_sent text, provider_reference text, status text)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_min_driver_age(p_country text, p_class text)` | `integer` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_no_delete()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_no_show_party_present(p_trip_id uuid, p_side text)` | `boolean` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_no_show_policy()` | `TABLE(host_absent_after interval, reply_wait interval, message_lead interval, declaration_window interval)` | `cmd_hold_owner` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_no_show_report_obstacle(p_trip_id uuid)` | `text` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_no_show_traced(p_trip_id uuid, p_side text, p_at timestamp with time zone)` | `boolean` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_occupied_period(p_start timestamp with time zone, p_end timestamp with time zone, p_buffer_minutes integer)` | `tstzrange` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_open_compensation(p_hold_id uuid, p_operation_id uuid, p_reason text)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_param_bool(p_key text, p_country text)` | `boolean` | `migrator` | catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_param_int(p_key text, p_country text)` | `integer` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_param_text(p_key text, p_country text)` | `text` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_place_hold_kind(p_vehicle_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_flagged boolean, p_kind text)` | `uuid` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_production_oracle()` | `TABLE(check_code text, violations bigint, by_country jsonb)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_production_oracle_alert()` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_record_payment_failure(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_record_poll(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_release_cancelled_holds(p_limit integer)` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_request_accept(p_token_hash bytea, p_org uuid, p_hold_id uuid)` | `jsonb` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_request_auth(p_operation_id uuid)` | `boolean` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_request_auth_settled(p_operation_id uuid)` | `boolean` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_request_decline(p_token_hash bytea, p_org uuid, p_hold_id uuid)` | `jsonb` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_request_host_gate(p_token_hash bytea, p_org uuid, p_hold_id uuid, p_action text)` | `text` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_request_record_capture(p_token_hash bytea, p_org uuid, p_hold_id uuid, p_operation_id uuid, p_provider_reference text)` | `text` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_request_restore_context(p_prev text[])` | `void` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_trip_apply_transition(p_trip_id uuid, p_from text, p_to text, p_reason text, p_origin text, p_actor_role text, p_via text, p_extra jsonb)` | `integer` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_trip_contract_signed(p_trip_id uuid)` | `boolean` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_trip_holds_slot(p_status text)` | `boolean` | `migrator` | cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_trip_lock(p_trip_id uuid, p_expected_row_version integer)` | `TABLE(id uuid, status text, country_code text, scheduled_end timestamp with time zone, row_version integer, no_show_at timestamp with time zone, checkin_validated_at timestamp with time zone)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.booking_trip_state_log_immutable()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_trip_transition_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_vehicle_party(p_vehicle_id uuid)` | `TABLE(org_id uuid, country_code text)` | `migrator` | cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_addition_open(p_org uuid, p_country text, p_vehicle uuid, p_user uuid, p_make text, p_model text, p_year integer, p_trim text, p_vin text)` | `uuid` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_area_label_is_address(p_area text)` | `boolean` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_document_key(p_org uuid, p_parent uuid, p_file uuid)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_document_required(p_type text, p_country text)` | `boolean` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_document_state(p_vehicle uuid, p_type text, p_strict boolean, p_today date)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_earnings_plan_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.catalog_effective_notice_minutes(p_vehicle_id uuid)` | `integer` | `migrator` | catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_host_context(p_token_hash bytea, p_org uuid)` | `TABLE(outcome text, user_id uuid, country_code text, org_status text)` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_listing_publish_blocker(p_listing uuid, p_user uuid, p_country text, p_org_status text)` | `text` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_normalize_plate(p_plate text)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_normalize_vin(p_vin text)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_param_bool(p_key text, p_country text)` | `boolean` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_param_int(p_key text, p_country text)` | `bigint` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_plan_param(p_key text, p_country text)` | `jsonb` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_price_step(p_country text)` | `bigint` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_pricing_outcome(p_country text, p_price bigint, p_mode text, p_km integer, p_extra bigint)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_public_text_norm(p_text text)` | `text` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE ; messaging_cmd_owner: EXECUTE |
| `core.catalog_request_mode_hours(p_country text)` | `integer` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_search_host_open(p_org uuid, p_country text)` | `boolean` | `migrator` | catalog_cmd_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_search_param_int(p_key text, p_country text)` | `integer` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_slug(p_name text)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_text_has_address_marker(p_text text)` | `boolean` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_text_has_contact(p_text text)` | `boolean` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_text_offers_offplatform_payment(p_text text)` | `boolean` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_value_class_resolve(p_country text, p_variant uuid, p_make_text text, p_model_text text)` | `TABLE(value_class text, source text, rule_id uuid)` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_vehicle_assign_value_class(p_vehicle uuid)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_vehicle_blockers(p_vehicle uuid, p_strict boolean)` | `text[]` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_vehicle_claim_target(p_token_hash bytea, p_org uuid, p_plate text, p_vin text)` | `TABLE(outcome text, user_id uuid, country_code text, target uuid, plate text, vin text)` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_vehicle_declare(p_token_hash bytea, p_org uuid, p_vehicle uuid, p_title_holder text, p_lien_declared boolean, p_odometer_km integer, p_ownership_attested boolean, p_lien_attested boolean, p_vin text, p_locale text, p_catalog_version integer, p_ownership_text text, p_lien_text text)` | `TABLE(outcome text, vehicle_id uuid)` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_vehicle_live_bookings(p_vehicle uuid)` | `jsonb` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_vehicle_needs_review(p_vehicle uuid)` | `boolean` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.catalog_vehicle_no_delete()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.catalog_vehicle_text_is_invalid(p_text text)` | `boolean` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_vehicle_value_class_follow()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.catalog_vehicle_writable(p_token_hash bytea, p_org uuid, p_vehicle uuid)` | `TABLE(outcome text, user_id uuid, country_code text, eligibility_status text)` | `catalog_cmd_owner` | catalog_cmd_owner: EXECUTE |
| `core.catalog_vin_kind(p_vin text)` | `text` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_asset_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_brand_authorize(p_token_hash bytea, p_permission text, p_country text, p_attempted text, p_subject_type text, p_subject_id uuid, p_request_id uuid, OUT outcome text, OUT actor uuid, OUT actor_role text)` | `record` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_body_allowed(p_body text)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_contrast_valid(p_check jsonb)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_no_truncate()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_brand_tokens_sha256(p_tokens jsonb)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_version_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_content_block_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_content_key_not_legal(p_key text)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.claim_evidence_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.claim_evidence_manifest(p_trip_id uuid, p_bundle_id uuid, p_purpose text, p_sealed_at timestamp with time zone)` | `jsonb` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.claim_incidental_bool(p_key text, p_country text)` | `boolean` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.claim_incidental_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.claim_incidental_param(p_key text, p_country text)` | `jsonb` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.claim_incidental_party(p_token_hash bytea, p_trip_id uuid)` | `TABLE(user_id uuid, role text)` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.claim_record_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_go_live(p_key text, p_country text)` | `boolean` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.config_go_live_request_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_go_live_write_refusal(p_op text, p_key text, p_old_key text, p_value jsonb, p_request_id uuid, p_approved_by uuid, p_decision_ref text)` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_param_owner: EXECUTE ; migrator: EXECUTE |
| `core.config_no_truncate()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_param_bound_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_param_change_check(p_key text, p_country text, p_value jsonb, p_currency text, OUT outcome text, OUT reason text)` | `record` | `migrator` | cmd_param_owner: EXECUTE ; migrator: EXECUTE |
| `core.config_param_change_request_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_param_value_go_live_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_param_value_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_tax_line_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_versioned_row_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.contract_document_immutable()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.ctr_account_country(p_user_id uuid)` | `text` | `migrator` | iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.ctr_consent_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.ctr_current_template(p_kind text, p_country text, p_language text, p_major_only boolean)` | `SETOF core.contract_document_template` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.ctr_host_terms_state(p_user_id uuid, p_country text, p_language text)` | `TABLE(template_id uuid, version integer, is_major boolean, locale text, title text, content_hash bytea, is_draft boolean, valid_from timestamp with time zone, required_version integer, accepted_version integer, accepted_at timestamp with time zone, reaccept_required boolean)` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.ctr_no_truncate()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.ctr_record_consent(p_user_id uuid, p_template_id uuid, p_accepted boolean, p_context text, p_country text)` | `void` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.ctr_template_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.ctr_writer_exempt()` | `boolean` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.finance_recon_month_state(p_country text)` | `jsonb` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.finance_recon_operation_kinds()` | `text[]` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.finance_recon_threshold_bps(p_country text)` | `integer` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.finance_reconciliation_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.iam_hmac_sha256(p_key bytea, p_msg bytea)` | `bytea` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_host_open_account(p_user uuid, p_country text, p_holder_kind text, p_actor uuid, p_actor_role text, p_source text, p_request_id uuid, p_reason text)` | `TABLE(outcome text, org_id uuid)` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_mfa_proof(p_key bytea, p_token_hash bytea, p_factor_id uuid, p_step bigint)` | `bytea` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_mfa_proof_key_rotate(p_action text, p_key bytea)` | `text` | `migrator` | migrator: EXECUTE |
| `core.iam_otp_hash_equal(p_a bytea, p_b bytea)` | `boolean` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_otp_param(p_key text, p_country text)` | `integer` | `migrator` | iam_auth_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_session_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.iam_staff_audit(p_actor uuid, p_role text, p_action text, p_subject_type text, p_subject_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_request_id uuid)` | `bigint` | `migrator` | cmd_golive_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_audit_countries(p_actor uuid, p_subject_type text, p_subject_id uuid, p_before jsonb, p_after jsonb)` | `text[]` | `migrator` | cmd_golive_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_authority(p_actor uuid, p_target uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_count_attempt(p_factor_id uuid, p_user uuid)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_permitted(p_user uuid, p_permission text, p_countries text[], p_roles text[])` | `text` | `migrator` | cmd_golive_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_session(p_token_hash bytea, OUT user_id uuid, OUT session_id uuid, OUT mfa_level text)` | `record` | `migrator` | cmd_golive_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_totp_step_now()` | `bigint` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.kyc_biometric_template(p_country text, p_language text)` | `SETOF core.contract_document_template` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_consent_current(p_user uuid, p_country text)` | `integer` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_emit_status(p_verification uuid, p_user uuid, p_version integer, p_from text, p_to text, p_reason text, p_country text, p_actor uuid, p_actor_role text)` | `void` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_first_approved_keep()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.kyc_host_account_signaled(p_user uuid)` | `boolean` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_activation_allowed(p_org uuid, p_country text)` | `boolean` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_auto_approve(p_org uuid)` | `text` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_blockers(p_org uuid)` | `text[]` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_emit_org(p_org uuid, p_type text, p_version integer, p_from text, p_to text, p_actor uuid, p_actor_role text, p_country text)` | `uuid` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_gates(p_org uuid)` | `TABLE(org_id uuid, user_id uuid, country_code text, org_status text, kyc_id uuid, age text, residence text, tax text, terms_ok boolean, screening_id uuid, screening_result text, submerchant_ok boolean, capabilities_ok boolean, p2p_open boolean, insurer_open boolean)` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_param(p_key text, p_country text)` | `jsonb` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_psp_requires_tax_id(p_org uuid)` | `boolean` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_refresh(p_dossier uuid)` | `text` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_review_due(p_country text, p_started timestamp with time zone)` | `boolean` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_tax_saved(p_org uuid)` | `boolean` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_host_try_activate(p_org uuid, p_actor uuid, p_actor_role text)` | `TABLE(outcome text, blockers text[], event_ids uuid[])` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_legal_name_bag(p_given text, p_surnames text)` | `text[]` | `migrator` | migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.kyc_legal_name_bags_match(p_a text[], p_b text[])` | `boolean` | `migrator` | migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.kyc_legal_name_key(p_given text, p_surnames text)` | `text` | `migrator` | kyc_cmd_owner: EXECUTE ; migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.kyc_legal_name_match(p_declared_first text, p_declared_last text, p_license_given text, p_license_surnames text)` | `text` | `migrator` | kyc_cmd_owner: EXECUTE ; migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.kyc_name_tokens(p_name text)` | `text[]` | `migrator` | kyc_cmd_owner: EXECUTE ; migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.kyc_retention_days(p_country text)` | `integer` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.kyc_review_enqueue(p_user uuid, p_actor uuid)` | `text` | `kyc_cmd_owner` | kyc_cmd_owner: EXECUTE |
| `core.messaging_mask_contacts(p_text text, OUT masked text, OUT kinds text[])` | `record` | `messaging_cmd_owner` | messaging_cmd_owner: EXECUTE |
| `core.messaging_meeting_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.messaging_offplatform_codes(p_text text)` | `text[]` | `messaging_cmd_owner` | messaging_cmd_owner: EXECUTE |
| `core.messaging_party(p_user uuid, p_trip_id uuid)` | `TABLE(role text, country_code text, org_id uuid, guest_user_id uuid, scheduled_end timestamp with time zone, timezone text)` | `messaging_cmd_owner` | messaging_cmd_owner: EXECUTE |
| `core.messaging_record_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.ops_monitor_metrics(p_since timestamp with time zone, p_webhook_failures integer)` | `TABLE(metric text, label text, country_code text, value bigint)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_begin_receipt(p_event_id uuid)` | `boolean` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_claim_jobs(p_limit integer, p_lease interval)` | `SETOF core.outbox_scheduled_job` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_complete_job(p_job_id uuid)` | `boolean` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_enqueue(p_name text, p_payload jsonb, p_singleton_key text, p_event_id uuid, p_run_at timestamp with time zone, p_delay interval, p_max_attempts integer)` | `boolean` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_fail_job(p_job_id uuid, p_error text, p_backoff_base interval)` | `text` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_mark_published(p_ids uuid[])` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_metrics()` | `TABLE(metric text, queue text, value bigint)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_reap_expired_jobs()` | `SETOF core.outbox_dead_letter` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_record_relay_failure(p_ids uuid[], p_error text)` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_relay_claim(p_limit integer)` | `SETOF core.outbox_outbox_event` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.payment_assert_settlement_order(p_operation_id uuid)` | `void` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_capability_bool(p_provider text, p_country text, p_method text, p_capability text)` | `boolean` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_capability_int(p_provider text, p_country text, p_method text, p_capability text)` | `integer` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_capability_value(p_provider text, p_country text, p_method text, p_capability text)` | `jsonb` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_debt_balance_guard()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_debt_collection_guard()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_deposit_amount_param(p_key text, p_country text)` | `jsonb` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.payment_deposit_effective_schedule(p_release_at timestamp with time zone, p_decision_at timestamp with time zone, p_auth_expiry_at timestamp with time zone, p_country text, p_trip_id uuid)` | `TABLE(release_at timestamp with time zone, decision_at timestamp with time zone)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.payment_deposit_hold_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_guard_leg_trip_attach()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_guard_operation_trip_attach()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_instrument_guard()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_missing_blocking_capabilities(p_provider text, p_country text, p_mode text)` | `text[]` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_mit_append_only()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_mit_attempt_due(p_first timestamp with time zone, p_offsets integer[], p_n integer)` | `timestamp with time zone` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_mit_consent_guard()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_mit_consent_mode(p_country text)` | `text` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_mit_open_debt(p_charge_id uuid, p_reason text)` | `uuid` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_mit_rule(p_country text, p_network text, p_reason text)` | `SETOF core.payment_mit_network_rule` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_operation_leg_release_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_partial_collection_legs(p_due bigint[], p_carried bigint[], p_amount bigint)` | `bigint[]` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_post_trip_attempt_guard()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_post_trip_charge_guard()` | `trigger` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_psp_account_fake_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_psp_submerchant_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_refund_advance_block(p_advance_id uuid)` | `text` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_refund_instance_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_refund_instance_supersede()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_text_has_pan(p_text text)` | `boolean` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_trip_leg_state(p_trip uuid)` | `TABLE(leg text, rank integer, moved numeric, refunded numeric, pending_debit numeric, pending_release numeric, available numeric, released numeric, frozen boolean, variation numeric)` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_trip_mit_consent(p_trip_id uuid)` | `SETOF core.payment_mit_consent` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payment_webhook_inbox_proof_columns_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payout_batch_hold_reasons(p_batch_id uuid)` | `text[]` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payout_business_day(p_country text, p_from date, p_n integer)` | `date` | `cmd_money_owner` | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.payout_effective_end(p_trip_id uuid)` | `timestamp with time zone` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payout_item_amount(p_trip_id uuid)` | `bigint` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payout_param(p_key text, p_country text)` | `jsonb` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payout_payout_account_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payout_payout_batch_adjustment_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payout_payout_batch_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payout_payout_item_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payout_refresh_batch(p_batch_id uuid, p_netting boolean)` | `void` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payout_schedule(p_trip_id uuid, p_first boolean)` | `timestamp with time zone` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.payout_titular(p_token_hash bytea, p_org uuid)` | `TABLE(outcome text, user_id uuid, country_code text, currency text)` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.pricing_digest(p_prefix text, p_text text)` | `text` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.pricing_minor(p_value jsonb)` | `numeric` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.pricing_ms(p_value jsonb)` | `numeric` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.pricing_param(p_key text, p_country text)` | `jsonb` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.pricing_ratio(p_value jsonb)` | `numeric[]` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.pricing_record_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.pricing_trip_fee(p_trip_price numeric, p_days numeric, p_schedule jsonb)` | `numeric` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.privacy_append_only()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.privacy_param(p_key text, p_country text)` | `jsonb` | `migrator` | migrator: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.privacy_worker_guard()` | `void` | `migrator` | migrator: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `core.report_staff_gate(p_token_hash bytea, p_permission text, p_country text, p_attempted text, p_request_id uuid)` | `TABLE(outcome text, user_id uuid, role text)` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.report_staff_not_found(p_token_hash bytea, p_attempted text, p_subject_id uuid, p_request_id uuid)` | `text` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.review_public_view(p_review_id uuid)` | `jsonb` | `review_cmd_owner` | review_cmd_owner: EXECUTE |
| `core.review_publish_trip(p_trip_id uuid)` | `integer` | `review_cmd_owner` | review_cmd_owner: EXECUTE |
| `core.review_record_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.review_window_of(p_trip_id uuid)` | `TABLE(ended_at timestamp with time zone, closes_at timestamp with time zone, window_days integer)` | `review_cmd_owner` | review_cmd_owner: EXECUTE |
| `core.risk_log_abuse(p_kind text, p_scope text, p_key_hash bytea, p_country text, p_signals text[])` | `void` | `migrator` | migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.security_incident_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.security_incident_notice_hours(p_key text, p_country text)` | `integer` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_finance_approval_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_guard_immutable()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_host_ledger_credit_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_insurer_bordereau_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_insurer_bordereau_issue_check()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_insurer_contract_of_trip(p_trip_id uuid)` | `TABLE(insurer_id uuid, contract_id uuid)` | `cmd_money_owner` | cmd_money_owner: EXECUTE |
| `core.settlement_insurer_contract_terms_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_insurer_vehicle_coverage(p_country text, p_timezone text, p_year integer, p_value_class text, p_plate_category text)` | `TABLE(outcome text, reasons text[], contract_id uuid)` | `migrator` | catalog_cmd_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_no_delete()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_platform_advance_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_release_at_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_release_blocker(p_operation_id uuid)` | `text` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_trip_chargeback_open(p_trip_id uuid)` | `boolean` | `migrator` | cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_trip_leg_balance_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_verify_alloc_host(p_amount numeric, p_share numeric[])` | `numeric` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_cxl_beta_1(p_inputs jsonb)` | `jsonb` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_cxl_beta_2(p_inputs jsonb)` | `jsonb` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_flag(p_value jsonb, p_name text)` | `boolean` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_floor_div(p_num numeric, p_den numeric)` | `numeric` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_host_from_guest(p_lines numeric[], p_host numeric[], p_delivery numeric[], p_extras numeric[])` | `numeric` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_int(p_value jsonb)` | `numeric` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_legs(p_trip jsonb, p_currency text, p_lines numeric[], p_tax_third boolean[], p_tax_kept numeric[], p_host_from_guest numeric)` | `numeric[]` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_minor(p_value jsonb, p_currency text)` | `numeric` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_ratio(p_value jsonb)` | `numeric[]` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.settlement_verify_round(p_amount numeric, p_num numeric, p_den numeric)` | `numeric` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_actor_conflict(p_actor uuid, p_subject_type text, p_subject_id uuid)` | `boolean` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_country_of_insurer_bordereau(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_country_of_organization(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_country_of_platform_advance(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_country_of_risk_assessment(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_country_of_support_case(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_country_of_trip(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_country_of_user_account(p_id uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_input_values_valid(p_keys text[], p_values jsonb)` | `boolean` | `migrator` | migrator: EXECUTE |
| `core.support_manual_action_handler_check(p_action text, p_handler regprocedure)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_manual_action_handler_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.support_manual_action_subject_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.support_org_people(p_org uuid)` | `uuid[]` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_person_people(p_user uuid)` | `uuid[]` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_queue_sla_minutes(p_queue text, p_country text)` | `integer` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_staff_catalog_item(p_user uuid, p_item_id uuid, p_attempted text, p_request_id uuid, OUT refusal text, OUT role text, OUT subject_id uuid, OUT country_code text)` | `record` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_staff_claim_gate(p_user uuid, p_claim_id uuid, p_permission text, p_attempted text, p_request_id uuid)` | `TABLE(deny text, role text, country_code text, trip_id uuid)` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_staff_covers_user(p_actor uuid, p_role text, p_user uuid, p_country text)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_staff_holds_permission(p_user uuid, p_permission text)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_staff_incidental_gate(p_user uuid, p_invoice_id uuid, p_permission text, p_attempted text, p_request_id uuid)` | `TABLE(deny text, role text, country_code text, trip_id uuid)` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_staff_legal_names(p_user uuid)` | `jsonb` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_staff_log_access(p_actor uuid, p_role text, p_subject_type text, p_subject_id uuid, p_field text, p_kind text, p_purpose text, p_case_ref text, p_request_id uuid, p_country text)` | `uuid` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.support_staff_org_holder_names(p_org uuid)` | `jsonb` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_staff_vehicle_gate(p_token_hash bytea, p_item_id uuid, p_subject_type text, p_attempted text, p_request_id uuid, OUT refusal text, OUT user_id uuid, OUT role text, OUT subject_id uuid, OUT country_code text)` | `record` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_staff_vehicle_item(p_user uuid, p_item_id uuid, p_subject_type text, p_attempted text, p_request_id uuid, OUT refusal text, OUT role text, OUT subject_id uuid, OUT country_code text)` | `record` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_subject_parties(p_subject_type text, p_subject_id uuid)` | `uuid[]` | `iam_staff_owner` | iam_staff_owner: EXECUTE |
| `core.support_subject_resolver_check(p_resolver regprocedure)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.trip_handover_apply(p_trip_id uuid, p_from text, p_to text, p_reason text, p_role text, p_user uuid, p_org uuid)` | `integer` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_handover_blockers(p_trip_id uuid)` | `text[]` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_handover_lock(p_trip_id uuid)` | `void` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_handover_party(p_token_hash bytea, p_trip_id uuid)` | `TABLE(user_id uuid, role text, trip_id uuid, org_id uuid, guest_user_id uuid, holder_user_id uuid, country_code text)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_inspection_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.trip_inspection_party(p_token_hash bytea, p_trip_id uuid, p_kind text)` | `TABLE(user_id uuid, role text, trip_id uuid, country_code text, open boolean)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_no_show_state(p_trip_id uuid, p_side text)` | `TABLE(blocker text, message_traced boolean, declarable_from timestamp with time zone, declarable_until timestamp with time zone)` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_overdue_case_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.trip_overdue_escalation_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.trip_overdue_escalation_hours(p_country text)` | `integer[]` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `core.trip_overdue_param_at(p_key text, p_country text, p_at timestamp with time zone)` | `integer` | `cmd_hold_owner` | cmd_hold_owner: EXECUTE |
| `platform.declare_environment(p_environment text)` | `text` | `migrator` | migrator: EXECUTE |
| `platform.deployment_env()` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; migrator: EXECUTE ; privacy_cmd_owner: EXECUTE |
| `platform.environment_declaration_immutable()` | `trigger` | `migrator` | migrator: EXECUTE |
| `platform.now()` | `timestamp with time zone` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; audit_chain_owner: EXECUTE ; catalog_cmd_owner: EXECUTE ; catalog_probe_owner: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; guard_owner: EXECUTE ; host_view_owner: EXECUTE ; iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE ; integrity_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; messaging_cmd_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE ; privacy_cmd_owner: EXECUTE ; review_cmd_owner: EXECUTE ; risk_limit_owner: EXECUTE |
| `platform.touch_row()` | `trigger` | `migrator` | migrator: EXECUTE |
| `platform.uuid_v7()` | `uuid` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; catalog_cmd_owner: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; cmd_param_owner: EXECUTE ; iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE ; kyc_cmd_owner: EXECUTE ; messaging_cmd_owner: EXECUTE ; migrator: EXECUTE ; privacy_cmd_owner: EXECUTE ; review_cmd_owner: EXECUTE |
