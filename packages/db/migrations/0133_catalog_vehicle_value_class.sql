-- 0133 — CAT : classe de valeur attribuée à la publication d'un véhicule non classé (BOARD N-83,
-- suite de N-101 et N-115 ; US-113, US-118 ; ADR-159 ; 08 BR-ACC-05 ; 17 §3.2.3). Appliquée sous
-- `migrator`, en une transaction.
--
-- Pourquoi : aucune variante du catalogue n'a de classe de valeur (graine v1 de 0063 et 680
-- variantes sans fiche de la douane, 0079 / 0095), pas plus qu'un véhicule hors catalogue. Or la
-- couverture du contrat de l'assureur (0081) tient une classe inconnue pour « jamais couverte » :
-- aucun véhicule n'était publiable, quel que soit le contrat (VEHICLE_NOT_COVERED).
--
-- Règle de classement (PROPOSÉE, ADR-159 ; « comme Turo, le moins de limitations possible » : la
-- classe suit la valeur du véhicule, la plupart des véhicules sont standard ; jamais une marque ou
-- un modèle de valeur haute rangé en standard), dans l'ordre, la première qui donne une classe :
--   1. CATALOG : classe de la variante du catalogue (saisie ou vérifiée par l'ops) ;
--   2. MODEL_RULE / MAKE_RULE : règle de `core.catalog_value_class_rule` sur le slug de la marque
--      et, s'il y a lieu, du modèle (variante du catalogue, sinon marque et modèle saisis par l'hôte,
--      passés par `core.catalog_slug`). Le modèle se reconnaît à son slug exact ou à un préfixe
--      suivi d'un tiret (« land-cruiser » couvre « land-cruiser-300 ») ; la règle la plus précise
--      l'emporte (modèle le plus long, puis règle du pays, puis la classe la plus haute) ;
--   3. COUNTRY_DEFAULT : paramètre `vehicle_default_value_class[pays]` (0132 ; STANDARD PROPOSÉ au
--      Panama et au Paraguay) ; absent ou illisible : aucune classe, le véhicule reste jamais
--      couvert (fail-closed, comme avant).
-- Graine des règles : marques et modèles dont la valeur dépasse nettement le premier seuil PROPOSÉ
-- de 08 BR-ACC-05 (35 000 $ ; LUXE au-delà de 70 000 $), saisis par l'équipe à partir de notoriété
-- publique, PROPOSÉS, sans aucun code pays ; elles ne font que RELEVER une classe (aucune règle ne
-- range un véhicule plus bas que le défaut). Valeurs définitives selon le contrat de l'assureur
-- (POUR_LE_FONDATEUR.md §3).
--
-- Quand : à la publication (`core.catalog_cmd_submit_listing`, corps de 0084 recopié ; une étape
-- ajoutée, marquée N-83), après le contrôle des photos et avant les contrôles automatiques :
-- un véhicule sans classe la reçoit, avec sa provenance (`value_class_source`) et la règle
-- appliquée (`value_class_rule_id`), qui l'expliquent à l'ops. Une classe déjà posée n'est jamais
-- recalculée. Si la variante d'un véhicule déjà classé par cette règle change (rattachement d'un
-- véhicule hors catalogue par l'ops, US-114), le déclencheur `catalog_vehicle_value_class_follow`
-- recalcule la classe avec la nouvelle variante : un véhicule publié ne perd jamais sa classe.
-- Les interrupteurs de mise en service ne sont pas touchés : sans contrat d'assureur en vigueur et
-- sans `insurer_contract_active[pays]`, la publication reste refusée (INSURER_CONTRACT_INACTIVE).
--
-- Expand / contract : table, colonnes facultatives, contraintes nouvelles (vraies pour toute
-- ligne existante : les colonnes nouvelles sont nulles), fonctions, déclencheur, politique et
-- droits ajoutés ; corps de `core.catalog_cmd_submit_listing` (0084) remplacé à signature,
-- propriétaire et droits identiques. La version N de l'API lit les mêmes issues.
--
-- Retour arrière :
--   réappliquer core.catalog_cmd_submit_listing de 0084 (sous catalog_cmd_owner) ;
--   DROP TRIGGER catalog_vehicle_value_class_follow ON core.catalog_vehicle ;
--   DROP FUNCTION core.catalog_vehicle_value_class_follow(),
--     core.catalog_vehicle_assign_value_class(uuid),
--     core.catalog_value_class_resolve(text, uuid, text, text) ;
--   DROP POLICY catalog_cmd_value_class_read ON core.config_param_value ;
--   ALTER TABLE core.catalog_vehicle DROP CONSTRAINT catalog_vehicle_value_class_source_known,
--     DROP CONSTRAINT catalog_vehicle_value_class_rule_match, DROP COLUMN value_class_rule_id,
--     DROP COLUMN value_class_source (les classes attribuées restent dans `value_class`) ;
--   DROP TABLE core.catalog_value_class_rule.

-- 1. Règles de classement (classe C : référence ; jamais supprimées, retirées par `status`) ------
CREATE TABLE core.catalog_value_class_rule (
  id           uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  -- NULL : tous les pays ; sinon la règle du pays l'emporte sur la règle commune
  country_code text
               CONSTRAINT catalog_value_class_rule_country_format
               CHECK (country_code ~ '^[A-Z]{2}$'),
  make_slug    text        NOT NULL
               CONSTRAINT catalog_value_class_rule_make_slug_format
               CHECK (make_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- NULL : toute la marque ; sinon le modèle (slug exact ou préfixe suivi d'un tiret)
  model_slug   text
               CONSTRAINT catalog_value_class_rule_model_slug_format
               CHECK (model_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  value_class  text        NOT NULL
               CONSTRAINT catalog_value_class_rule_class_valid
               CHECK (value_class IN ('STANDARD', 'PREMIUM', 'LUXE')),
  status       text        NOT NULL DEFAULT 'ACTIVE'
               CONSTRAINT catalog_value_class_rule_status_valid
               CHECK (status IN ('ACTIVE', 'RETIRED')),
  source_ref   text        NOT NULL
               CONSTRAINT catalog_value_class_rule_source_ref_valid
               CHECK (pg_catalog.char_length(source_ref) BETWEEN 3 AND 300),
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_value_class_rule_unique
    UNIQUE NULLS NOT DISTINCT (country_code, make_slug, model_slug)
);
CREATE TRIGGER catalog_value_class_rule_no_delete
  BEFORE DELETE ON core.catalog_value_class_rule
  FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_value_class_rule_no_truncate
  BEFORE TRUNCATE ON core.catalog_value_class_rule
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete();
ALTER TABLE core.catalog_value_class_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_value_class_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_value_class_rule TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.catalog_value_class_rule FROM PUBLIC;
-- lecture par les commandes du catalogue (classement à la publication) ; aucun droit applicatif
GRANT SELECT ON core.catalog_value_class_rule TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.catalog_value_class_rule FOR SELECT TO catalog_cmd_owner
  USING (true);
COMMENT ON TABLE core.catalog_value_class_rule IS
  'CAT : règles de classement de la valeur d''un véhicule par marque et modèle (08 BR-ACC-05), '
  'appliquées à la publication quand la variante n''a pas de classe ; PROPOSÉES, selon le contrat '
  'de l''assureur. Aucun droit applicatif ; jamais supprimées. N-83 (ADR-159).';

-- Graine PROPOSÉE (aucun code pays : règles communes). Classes : 08 BR-ACC-05, seuils PROPOSÉS
-- (STANDARD < 35 000 $, PREMIUM 35 000 à 70 000 $, LUXE > 70 000 $, prix d'un véhicule récent).
-- Les slugs suivent `core.catalog_slug` : ceux du catalogue, plus les variantes d'écriture d'une
-- saisie libre (« Mercedes », « Range Rover » saisi comme marque).
INSERT INTO core.catalog_value_class_rule (make_slug, model_slug, value_class, source_ref) VALUES
  -- marques de luxe : LUXE pour toute la marque
  ('aston-martin', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('bentley', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('bugatti', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('ferrari', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('lamborghini', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('lotus', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('maserati', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('maybach', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('mclaren', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('mercedes-maybach', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('porsche', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  ('range-rover', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle saisi comme marque)'),
  ('rolls-royce', NULL, 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque de luxe)'),
  -- marques premium : PREMIUM pour toute la marque
  ('acura', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('alfa-romeo', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('audi', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('bmw', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('cadillac', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('ds', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('genesis', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('hummer', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('infiniti', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('jaguar', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('land-rover', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('lexus', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('lincoln', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('mercedes', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium, saisie libre)'),
  ('mercedes-amg', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('mercedes-benz', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('mini', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('polestar', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('ram', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (pick-up pleine taille)'),
  ('tesla', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  ('volvo', NULL, 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (marque premium)'),
  -- modèles de luxe d'une marque premium ou généraliste : LUXE
  ('audi', 'q8', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('audi', 'r8', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('bmw', 'serie-7', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('bmw', 'x7', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('chevrolet', 'corvette', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('land-rover', 'defender', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('land-rover', 'range-rover', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('lexus', 'lx', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('mercedes-benz', 'amg-gt', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('mercedes-benz', 'clase-g', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('mercedes-benz', 'clase-s', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('mercedes-benz', 'g-class', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('mercedes-benz', 'gls', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('mercedes-benz', 's-class', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe, saisie libre)'),
  ('mercedes-benz', 'sl', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('nissan', 'gt-r', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  ('toyota', 'land-cruiser', 'LUXE', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle de luxe)'),
  -- modèles de valeur haute d'une marque généraliste : PREMIUM
  ('chevrolet', 'camaro', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('chevrolet', 'silverado', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('chevrolet', 'suburban', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('chevrolet', 'tahoe', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('dodge', 'challenger', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('dodge', 'charger', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('dodge', 'durango', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('dodge', 'ram', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (pick-up pleine taille)'),
  ('ford', 'bronco', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('ford', 'expedition', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('ford', 'f-150', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (pick-up pleine taille)'),
  ('ford', 'mustang', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('jeep', 'grand-cherokee', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('jeep', 'wrangler', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('nissan', 'patrol', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('toyota', 'alphard', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('toyota', 'land-cruiser-prado', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('toyota', 'sequoia', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('toyota', 'supra', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (modèle premium)'),
  ('toyota', 'tundra', 'PREMIUM', '08 BR-ACC-05 ; N-83 graine PROPOSÉE (pick-up pleine taille)');

-- 2. Provenance de la classe d'un véhicule (17 §3.2.3 vehicle) ------------------------------------
ALTER TABLE core.catalog_vehicle
  ADD COLUMN value_class_source text
    CONSTRAINT catalog_vehicle_value_class_source_valid
    CHECK (value_class_source IN ('CATALOG', 'MODEL_RULE', 'MAKE_RULE', 'COUNTRY_DEFAULT')),
  ADD COLUMN value_class_rule_id uuid REFERENCES core.catalog_value_class_rule (id),
  -- une provenance n'existe qu'avec une classe ; la règle n'est nommée que pour une règle
  ADD CONSTRAINT catalog_vehicle_value_class_source_known
    CHECK (value_class_source IS NULL OR value_class IS NOT NULL),
  ADD CONSTRAINT catalog_vehicle_value_class_rule_match
    CHECK (CASE WHEN value_class_source IN ('MODEL_RULE', 'MAKE_RULE')
                THEN value_class_rule_id IS NOT NULL
                ELSE value_class_rule_id IS NULL END);
COMMENT ON COLUMN core.catalog_vehicle.value_class_source IS
  'Provenance de la classe attribuée à la publication (N-83, ADR-159) : CATALOG (variante), '
  'MODEL_RULE / MAKE_RULE (core.catalog_value_class_rule), COUNTRY_DEFAULT '
  '(vehicle_default_value_class) ; NULL : classe posée hors de cette règle, ou aucune.';
COMMENT ON COLUMN core.catalog_vehicle.value_class_rule_id IS
  'Règle de classement appliquée (MODEL_RULE, MAKE_RULE), sinon NULL. N-83 (ADR-159).';
GRANT UPDATE (value_class_source, value_class_rule_id) ON core.catalog_vehicle TO catalog_cmd_owner;

-- 3. Lecture du défaut du pays par les commandes du catalogue (cette clé seulement) ---------------
CREATE POLICY catalog_cmd_value_class_read ON core.config_param_value FOR SELECT
  TO catalog_cmd_owner
  USING (key = 'vehicle_default_value_class');

-- 4. Classement (propriétaire migrator, SECURITY INVOKER, EXECUTE à catalog_cmd_owner) -----------
-- Classe d'un véhicule : variante, sinon règle de modèle ou de marque, sinon défaut du pays ;
-- aucune ligne écrite. Rend (NULL, NULL, NULL) si rien ne donne de classe (fail-closed).
CREATE FUNCTION core.catalog_value_class_resolve(p_country text, p_variant uuid, p_make_text text,
                                                 p_model_text text)
  RETURNS TABLE (value_class text, source text, rule_id uuid)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now   timestamptz := platform.now();
  v_class text;
  v_make  text;
  v_model text;
  v_rule  record;
  v_def   text;
BEGIN
  IF p_country IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  -- 1. classe de la variante du catalogue
  IF p_variant IS NOT NULL THEN
    SELECT v.value_class, m.slug, o.slug INTO v_class, v_make, v_model
      FROM core.catalog_vehicle_variant AS v
      JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
      JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
     WHERE v.id = p_variant;
    IF v_class IS NOT NULL THEN
      RETURN QUERY SELECT v_class, 'CATALOG'::text, NULL::uuid;
      RETURN;
    END IF;
  END IF;
  -- 2. règle de modèle ou de marque (variante du catalogue, sinon saisie de l'hôte)
  v_make := COALESCE(v_make, core.catalog_slug(p_make_text));
  v_model := COALESCE(v_model, core.catalog_slug(p_model_text));
  IF v_make IS NOT NULL THEN
    SELECT r.id, r.value_class, r.model_slug INTO v_rule
      FROM core.catalog_value_class_rule AS r
     WHERE r.status = 'ACTIVE' AND r.make_slug = v_make
       AND (r.country_code IS NULL OR r.country_code = p_country)
       AND (r.model_slug IS NULL
            OR (v_model IS NOT NULL
                AND (v_model = r.model_slug
                     OR pg_catalog.starts_with(v_model, r.model_slug || '-'))))
     ORDER BY pg_catalog.char_length(COALESCE(r.model_slug, '')) DESC,
              (r.country_code IS NOT NULL) DESC,
              CASE r.value_class WHEN 'LUXE' THEN 3 WHEN 'PREMIUM' THEN 2 ELSE 1 END DESC
     LIMIT 1;
    IF v_rule.id IS NOT NULL THEN
      RETURN QUERY SELECT v_rule.value_class,
                          CASE WHEN v_rule.model_slug IS NULL THEN 'MAKE_RULE'
                               ELSE 'MODEL_RULE' END::text,
                          v_rule.id;
      RETURN;
    END IF;
  END IF;
  -- 3. défaut du pays en vigueur (chaîne de la liste fermée, sinon aucune classe)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(pv.value) = 'string' THEN pv.value #>> '{}' END
    INTO v_def
    FROM core.config_param_value AS pv
   WHERE pv.key = 'vehicle_default_value_class' AND pv.country_code::text = p_country
     AND pv.scope_type = 'COUNTRY'
     AND pv.valid_from <= v_now AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
   ORDER BY pv.valid_from DESC
   LIMIT 1;
  IF v_def IN ('STANDARD', 'PREMIUM', 'LUXE') THEN
    RETURN QUERY SELECT v_def, 'COUNTRY_DEFAULT'::text, NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY SELECT NULL::text, NULL::text, NULL::uuid;
END
$fn$;
COMMENT ON FUNCTION core.catalog_value_class_resolve(text, uuid, text, text) IS
  'Classe de valeur d''un véhicule : variante du catalogue (CATALOG), règle de modèle ou de marque '
  '(MODEL_RULE, MAKE_RULE), défaut du pays (COUNTRY_DEFAULT) ; sinon aucune (fail-closed). Lecture '
  'seule. EXECUTE catalog_cmd_owner. N-83 (ADR-159).';

-- Attribution à un véhicule SANS classe (appelée par la publication, sous catalog_cmd_owner) ;
-- rend la classe du véhicule après l'appel (NULL : toujours sans classe). Une classe posée n'est
-- jamais recalculée.
CREATE FUNCTION core.catalog_vehicle_assign_value_class(p_vehicle uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v record;
  r record;
BEGIN
  SELECT x.id, x.country_code, x.variant_id, x.make_text, x.model_text, x.value_class INTO v
    FROM core.catalog_vehicle AS x WHERE x.id = p_vehicle;
  IF v.id IS NULL OR v.value_class IS NOT NULL THEN
    RETURN v.value_class;
  END IF;
  SELECT * INTO r
    FROM core.catalog_value_class_resolve(v.country_code, v.variant_id, v.make_text, v.model_text);
  IF r.value_class IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE core.catalog_vehicle AS x
     SET value_class = r.value_class, value_class_source = r.source,
         value_class_rule_id = r.rule_id
   WHERE x.id = p_vehicle AND x.value_class IS NULL;
  RETURN r.value_class;
END
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_assign_value_class(uuid) IS
  'Attribue au véhicule sans classe la classe de core.catalog_value_class_resolve, avec sa '
  'provenance et sa règle ; une classe posée n''est jamais recalculée. EXECUTE catalog_cmd_owner. '
  'N-83 (ADR-159).';

-- Variante changée d'un véhicule classé par cette règle (rattachement par l'ops, US-114) : la
-- classe est recalculée avec la nouvelle variante (sa classe si elle en a une, sinon les règles et
-- le défaut) ; un véhicule publié ne perd jamais sa classe tant qu'une règle la donne.
CREATE FUNCTION core.catalog_vehicle_value_class_follow()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  SELECT * INTO r
    FROM core.catalog_value_class_resolve(NEW.country_code, NEW.variant_id, NEW.make_text,
                                          NEW.model_text);
  NEW.value_class := r.value_class;
  NEW.value_class_source := r.source;
  NEW.value_class_rule_id := r.rule_id;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_value_class_follow() IS
  'Déclencheur : recalcule la classe d''un véhicule déjà classé par la règle de N-83 quand sa '
  'variante change (ADR-159).';
CREATE TRIGGER catalog_vehicle_value_class_follow
  BEFORE UPDATE OF variant_id ON core.catalog_vehicle
  FOR EACH ROW
  WHEN (OLD.variant_id IS DISTINCT FROM NEW.variant_id AND OLD.value_class_source IS NOT NULL)
  EXECUTE FUNCTION core.catalog_vehicle_value_class_follow();

REVOKE ALL ON FUNCTION core.catalog_value_class_resolve(text, uuid, text, text),
  core.catalog_vehicle_assign_value_class(uuid), core.catalog_vehicle_value_class_follow()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_value_class_resolve(text, uuid, text, text),
  core.catalog_vehicle_assign_value_class(uuid) TO catalog_cmd_owner;

-- 5. Publication (corps de 0084 recopié ; une étape ajoutée, marquée N-83) -----------------------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;
CREATE OR REPLACE FUNCTION core.catalog_cmd_submit_listing(p_token_hash bytea, p_org uuid,
                                                           p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_status  text;
  v_vehicle uuid;
  v_min     bigint;
  v_photos  integer;
  v_block   text;
  v_review  boolean;
  v_item    record;
  v_to      text;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status, l.vehicle_id INTO v_status, v_vehicle
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  -- SM-2 : DRAFT → publication ; REJECTED → correction et nouvelle soumission ; UNLISTED →
  -- remise en ligne ; toute autre source est refusée (19 US-118 critère 1)
  IF v_status NOT IN ('DRAFT', 'REJECTED', 'UNLISTED') THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- photos (BR-LIST-05, 16 HST-012) : photos non retirées et non refusées
  v_min := core.catalog_param_int('listing_min_photos', h.country_code);
  IF v_min IS NULL OR v_min < 1 THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_photos
    FROM core.catalog_listing_photo AS p
   WHERE p.listing_id = p_listing_id AND p.deleted_at IS NULL AND p.status <> 'REJECTED';
  IF v_photos < v_min THEN
    RETURN QUERY SELECT 'PHOTO_MIN_COUNT'::text, NULL::uuid;
    RETURN;
  END IF;
  -- N-83 (ADR-159) : un véhicule sans classe de valeur la reçoit (variante, règle de modèle ou de
  -- marque, défaut du pays) avant les contrôles automatiques ; rien ne la donne : il reste sans
  -- classe, jamais couvert (VEHICLE_NOT_COVERED, fail-closed)
  PERFORM core.catalog_vehicle_assign_value_class(v_vehicle);
  -- contrôles automatiques (zone, CGU, compte, pays, véhicule, assureur) : sinon l'annonce reste
  -- dans son état ; un véhicule hors catalogue ne bloque pas (DEC-FONDATEUR-22)
  v_block := core.catalog_listing_publish_blocker(p_listing_id, h.user_id, h.country_code,
                                                  h.org_status);
  IF v_block IS NOT NULL THEN
    RETURN QUERY SELECT v_block, NULL::uuid;
    RETURN;
  END IF;
  -- revue de l'ops exigée par le pays ? false par défaut (DEC-FONDATEUR-22) ; absent ⇒ exigée
  v_review := COALESCE(core.catalog_param_bool('listing_manual_review_required', h.country_code),
                       true);
  IF v_review THEN
    SELECT * INTO v_item
      FROM core.support_enqueue_review('LISTING', 'LISTING', p_listing_id, h.country_code,
                                       h.user_id);
    IF v_item.outcome IS DISTINCT FROM 'CREATED' AND v_item.outcome IS DISTINCT FROM 'EXISTS' THEN
      RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
      RETURN;
    END IF;
    v_to := 'PENDING_REVIEW';
    UPDATE core.catalog_listing AS l
       SET status = v_to, submitted_at = platform.now(), updated_by = h.user_id
     WHERE l.id = p_listing_id;
    INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                      subject_id, before, after)
    VALUES (h.user_id, 'P2P_HOST', 'LISTING_SUBMITTED', 'LISTING', p_listing_id,
            pg_catalog.jsonb_build_object('status', v_status),
            pg_catalog.jsonb_build_object('status', v_to, 'orgId', p_org,
                                          'country', h.country_code, 'itemId', v_item.item_id,
                                          'countries', pg_catalog.jsonb_build_array(h.country_code)));
  ELSE
    v_to := 'LISTED';
    UPDATE core.catalog_listing AS l
       SET status = v_to, submitted_at = platform.now(), published_at = platform.now(),
           updated_by = h.user_id
     WHERE l.id = p_listing_id;
    INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                      subject_id, before, after)
    VALUES (h.user_id, 'P2P_HOST', 'LISTING_PUBLISHED', 'LISTING', p_listing_id,
            pg_catalog.jsonb_build_object('status', v_status),
            pg_catalog.jsonb_build_object('status', v_to, 'orgId', p_org,
                                          'country', h.country_code, 'reason', 'AUTO_CHECKS',
                                          'countries', pg_catalog.jsonb_build_array(h.country_code)));
  END IF;
  RETURN QUERY SELECT v_to, p_listing_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) IS
  'Publication SM-2 (DRAFT, REJECTED, UNLISTED -> LISTED ; PENDING_REVIEW si le pays exige la revue) '
  ': photos, classe de valeur attribuée à un véhicule non classé (N-83), zone sans adresse, CGU de '
  'l''hôte, compte ACTIVE, pays ouvert, véhicule publiable, contrat d''assureur ; journalisée. '
  'SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; US-126 (ADR-100) ; US-114 (ADR-104) ; '
  'US-118 (ADR-114) ; N-83 (ADR-159).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
