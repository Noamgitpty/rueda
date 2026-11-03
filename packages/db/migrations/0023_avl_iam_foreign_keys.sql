-- 0023 — clés étrangères AVL → IAM et cohérence pays du compte d'hôte.
-- US-011 ; report d'US-010 (passation, « Reste » 0 bis) ; 17 §2.3 « Compte d'hôte » (mono-pays),
-- « Portée par pays », §3.2.1, §3.2.4 ; ADR-053. Appliquée sous `migrator`.
--
-- 1. `guest_user_id` des holds, trips et occupations du voyageur désigne un vrai compte.
-- 2. `(org_id, country_code)` des holds et trips désigne un compte d'hôte DE CE PAYS : un compte
--    d'hôte est mono-pays (17 §2.3), donc un trip ne peut pas porter un pays différent de celui de
--    son hôte. C'est sur ce `country_code` que portent les politiques du staff (portée par pays,
--    RLS-20) : la clé composée empêche qu'une ligne d'un hôte PY soit étiquetée d'un autre pays.
-- 3. `UNIQUE (id, country_code)` sur le trip : cible de la clé composée du dossier de support
--    (0024), dont le pays est ainsi celui du trip.
--
-- Les contrôles des clés étrangères ne sont pas soumis à la RLS (PostgreSQL) : ils voient le
-- compte même quand l'écrivain ne le voit pas, sans rien lui en révéler (23503 sans DETAIL
-- exploitable, traduit par packages/db/src/errors.ts).
-- Tables vides en production à ce stade (aucun écrivain hors tests) : la validation est immédiate.
--
-- Retour arrière :
--   ALTER TABLE core.booking_checkout_hold DROP CONSTRAINT checkout_hold_guest_fk,
--     DROP CONSTRAINT checkout_hold_org_country_fk;
--   ALTER TABLE core.booking_trip DROP CONSTRAINT trip_guest_fk, DROP CONSTRAINT trip_org_country_fk,
--     DROP CONSTRAINT trip_id_country_unique;
--   ALTER TABLE core.booking_guest_occupancy DROP CONSTRAINT guest_occupancy_guest_fk;
--   ALTER TABLE core.iam_organization DROP CONSTRAINT organization_id_country_unique;

ALTER TABLE core.iam_organization
  ADD CONSTRAINT organization_id_country_unique UNIQUE (id, country_code);

ALTER TABLE core.booking_checkout_hold
  ADD CONSTRAINT checkout_hold_guest_fk
    FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account (id),
  ADD CONSTRAINT checkout_hold_org_country_fk
    FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization (id, country_code);

ALTER TABLE core.booking_trip
  ADD CONSTRAINT trip_guest_fk
    FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account (id),
  ADD CONSTRAINT trip_org_country_fk
    FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization (id, country_code),
  ADD CONSTRAINT trip_id_country_unique UNIQUE (id, country_code);

ALTER TABLE core.booking_guest_occupancy
  ADD CONSTRAINT guest_occupancy_guest_fk
    FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account (id);

-- Index des colonnes référençantes lues par les politiques (0025) et par les contrôles de
-- suppression côté IAM.
CREATE INDEX checkout_hold_org_idx ON core.booking_checkout_hold (org_id);
CREATE INDEX trip_org_vehicle_idx ON core.booking_trip (org_id, vehicle_id);
CREATE INDEX trip_guest_idx ON core.booking_trip (guest_user_id);
CREATE INDEX payment_operation_trip_idx ON core.payment_payment_operation (trip_id)
  WHERE (trip_id IS NOT NULL);
