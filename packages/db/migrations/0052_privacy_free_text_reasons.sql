-- 0052 — Données personnelles : motifs libres fermés ou retirés des lectures applicatives.
-- US-046 (revue sécurité, constat 1) ; 17 §3.1.4 (C2 : accès par rôle et portée), §2.3 ; ADR-077,
-- ADR-081. Appliquée sous `migrator`.
--
-- Un motif en texte libre peut porter une donnée personnelle (nom, téléphone, circonstance) : il est
-- classé C2 (personal-data-inventory.json). Deux corrections, au choix par colonne :
--   1. core.config_param_value.change_reason : lu par app_api avec une lecture « tout » (tout
--      contexte, sans session comprise). Le droit de lecture de la colonne est RETIRÉ à app_api
--      (aucun code de l'API ne la lit) ; elle reste lisible des travailleurs et du staff par leurs
--      chemins dédiés. Contraction déclarée (expand-contract-allowlist.json).
--   2. Motifs du trip (annulation, fin anticipée) et de suspension du sous-marchand : un CODE de
--      motif (`^[A-Z][A-Z0-9_]{1,63}$`), jamais du texte libre. Le trip reste lisible du seul
--      voyageur et du seul hôte (et co-hôte de portée) de ce trip, et du staff par dossier
--      (matrice d'US-043) ; le sous-marchand n'expose pas ce motif à app_api.
-- Tables vides en production (aucune version servie) : les contraintes valident les lignes
-- existantes à l'ajout (aucune NOT VALID).
--
-- Retour arrière :
--   GRANT SELECT (change_reason) ON core.config_param_value TO app_api;
--   ALTER TABLE core.booking_trip DROP CONSTRAINT trip_cancellation_reason_code,
--     DROP CONSTRAINT trip_termination_reason_code;
--   ALTER TABLE core.payment_psp_submerchant DROP CONSTRAINT psp_submerchant_reason_code;

REVOKE SELECT (change_reason) ON core.config_param_value FROM app_api;

ALTER TABLE core.booking_trip
  ADD CONSTRAINT trip_cancellation_reason_code
    CHECK (cancellation_reason IS NULL OR cancellation_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ADD CONSTRAINT trip_termination_reason_code
    CHECK (termination_reason IS NULL OR termination_reason ~ '^[A-Z][A-Z0-9_]{1,63}$');

ALTER TABLE core.payment_psp_submerchant
  ADD CONSTRAINT psp_submerchant_reason_code
    CHECK (suspended_reason IS NULL OR suspended_reason ~ '^[A-Z][A-Z0-9_]{1,63}$');

COMMENT ON COLUMN core.booking_trip.cancellation_reason IS
  'Code de motif d''annulation (C2, jamais de texte libre) ; lu du voyageur et de l''hôte du trip. US-046.';
COMMENT ON COLUMN core.booking_trip.termination_reason IS
  'Code de motif de fin anticipée (C2, jamais de texte libre). US-046.';
COMMENT ON COLUMN core.payment_psp_submerchant.suspended_reason IS
  'Code de motif de suspension (C2, jamais de texte libre), non lu par app_api. US-046.';
