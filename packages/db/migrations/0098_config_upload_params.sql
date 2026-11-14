-- 0098 — graine complémentaire : paramètres « upload_* » (US-122 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « upload_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('upload_documents_per_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §5 ; red team du lot 1, F2-U-02 : dépôts de pièces d''un même véhicule sur une minute glissante (rafale) ; absent : refus DOCUMENT_RATE_LIMITED', 'PROPOSÉ (comme Turo : débit d''un dépôt humain, jamais atteint par un hôte honnête)'),
  ('upload_gallery_photos_max', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 HST-012 ; red team du lot 1, F2-U-02 : photos d''une même annonce (galerie), retirées et refusées exclues ; ce n''est pas un plafond de véhicules ni d''annonces (DEC-FONDATEUR-19) ; absent : refus PHOTO_LIMIT_REACHED', 'PROPOSÉ (comme Turo : très au-dessus d''une galerie ordinaire, aucun hôte honnête bloqué)'),
  ('upload_photo_max_kb', 'INT', 'kb', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §5 (taille maximale d''un fichier reçu) ; 16 HST-012 ; red team du lot 1, F2-U-02 : taille déclarée d''une photo d''annonce bornée par la base, comme celle d''une pièce (défense en profondeur ; absent : refus PHOTO_FORMAT)', 'PROPOSÉ (comme Turo : le moins limitant raisonnable, 10 Mio, borne de l''API)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('upload_documents_per_minute', 'PA', 'COUNTRY', NULL, NULL, '20'::jsonb, 'graine US-122 : défauts PROPOSÉS (red team F2-U-02, ADR-124)'),
  ('upload_documents_per_minute', 'PY', 'COUNTRY', NULL, NULL, '20'::jsonb, 'graine US-122 : défauts PROPOSÉS (red team F2-U-02, ADR-124)'),
  ('upload_gallery_photos_max', 'PA', 'COUNTRY', NULL, NULL, '100'::jsonb, 'graine US-122 : défauts PROPOSÉS (red team F2-U-02, ADR-124)'),
  ('upload_gallery_photos_max', 'PY', 'COUNTRY', NULL, NULL, '100'::jsonb, 'graine US-122 : défauts PROPOSÉS (red team F2-U-02, ADR-124)'),
  ('upload_photo_max_kb', 'PA', 'COUNTRY', NULL, NULL, '10240'::jsonb, 'graine US-122 : défauts PROPOSÉS (red team F2-U-02, ADR-124)'),
  ('upload_photo_max_kb', 'PY', 'COUNTRY', NULL, NULL, '10240'::jsonb, 'graine US-122 : défauts PROPOSÉS (red team F2-U-02, ADR-124)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'upload\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre upload_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
