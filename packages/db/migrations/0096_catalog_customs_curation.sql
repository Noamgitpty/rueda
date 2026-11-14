-- 0096 — CAT : curation de l'import de la douane, lot 2 (N-101 ; ADR-123, ADR-109 §7 ; revue de
-- code US-113 n° 4). Appliquée sous `migrator`, en une transaction. Expand seulement (ADR-081) :
-- des lignes insérées, aucune ligne existante modifiée.
--
-- Curation relue sur les libellés bruts du CSV source (empreinte `sourceSha256` du fichier de
-- données) :
--   - JMC Vigor RÉTABLI (« CAMIONETA DOBLE CABINA MARCA JMC, MODELO VIGOR », 34 unités de 2015 à
--     2018) : le lot 1 l'avait écarté à tort comme un mot de la déclaration ; variante sans fiche,
--     années indicatives, COMMUNE à tous les pays (`market` nul, comme 0095 pour le lot 1) ;
--   - « Chevrolet Trucker » → Tracker et « Ford Sport » → EcoSport CONFIRMÉS (libellés « TRUCKER LS
--     1.2 FLEX TURBO », « MODELO ECO SPORT 1.4L ») : rien à changer ;
--   - « Chery Face » (modèle commercialisé) et « Mini JCW » (finition vendue comme modèle) gardés :
--     un hôte les cherche sous ce nom ; un retrait serait un UPDATE (contraction), sans gain.
-- La graine ci-dessous est GÉNÉRÉE depuis apps/api/src/modules/cat/data/vehicle-catalog-dnit.json
-- (lignes `lot: 2`) par apps/api/src/modules/cat/internal/vehicle-catalog/customs-import.ts ;
-- customs-import.test.ts compare. Aucun code pays : la variante est commune.
-- Retour arrière : `status = 'RETIRED'` sur le modèle et sa variante (jamais de DELETE, garde de
-- 0063), si aucun véhicule ne la référence.

-- >>> graine générée (US-113, import de la douane) : ne pas éditer à la main
-- Source : apps/api/src/modules/cat/data/vehicle-catalog-dnit.json (version 1, lot 2),
-- rendue par apps/api/src/modules/cat/internal/vehicle-catalog/customs-import.ts.
-- Lot 2 : 0 marque(s) et 1 modèle(s) nouveaux, 1 variante(s) sans fiche, communes à tous les pays (market nul).
INSERT INTO core.catalog_vehicle_model
  (id, make_id, slug, name, aliases, status, source, source_ref, license_note)
SELECT r.id::uuid, r.make_id::uuid, r.slug, r.name, r.aliases, 'ACTIVE', p.source, p.source_ref, p.license_note
  FROM (VALUES
  ('a061318a-b71a-8f03-94a1-128407958ced', 'b4c146f0-9971-8c67-ae7f-59badb32de46', 'vigor', 'Vigor', ARRAY[]::text[], 1)
  ) AS r (id, make_id, slug, name, aliases, provenance)
  LEFT JOIN (VALUES
  (1, 'DNIT_ADUANAS_PY', 'DNIT-Aduanas SOFIA, datosabiertos.aduana.gov.py, ítems 8703 y 8704 ≤ 5 t, muestra 1997–2026 extraída el 2026-11-12, catálogo DNIT v1',
   'Datos abiertos de la DNIT – Gerencia General de Aduanas (https://datosabiertos.aduana.gov.py), última actualización: octubre 2026, consultado 2026-11-12. Licencia de Uso de la Información Pública del Gobierno Paraguayo (Decreto 4064 / Ley 5282/2014, https://www.paraguay.gov.py/datos-abiertos/licencias): uso y transformación libres citando la fuente y la fecha; normalización propia de la plataforma, sin aval oficial del Estado paraguayo.')
  ) AS p (k, source, source_ref, license_note) ON p.k = r.provenance;
INSERT INTO core.catalog_vehicle_variant
  (id, model_id, year_from, year_to, market, status, source, source_ref, license_note)
SELECT r.id::uuid, r.model_id::uuid, r.year_from::integer, r.year_to::integer, r.market::char(2), 'ACTIVE', p.source, p.source_ref, p.license_note
  FROM (VALUES
  ('06f475f6-3339-89d3-935b-5ceffacb18a5', 'a061318a-b71a-8f03-94a1-128407958ced', 2014, NULL, NULL, 1)
  ) AS r (id, model_id, year_from, year_to, market, provenance)
  LEFT JOIN (VALUES
  (1, 'DNIT_ADUANAS_PY', 'DNIT-Aduanas SOFIA, datosabiertos.aduana.gov.py, ítems 8703 y 8704 ≤ 5 t, muestra 1997–2026 extraída el 2026-11-12, catálogo DNIT v1',
   'Datos abiertos de la DNIT – Gerencia General de Aduanas (https://datosabiertos.aduana.gov.py), última actualización: octubre 2026, consultado 2026-11-12. Licencia de Uso de la Información Pública del Gobierno Paraguayo (Decreto 4064 / Ley 5282/2014, https://www.paraguay.gov.py/datos-abiertos/licencias): uso y transformación libres citando la fuente y la fecha; normalización propia de la plataforma, sin aval oficial del Estado paraguayo.')
  ) AS p (k, source, source_ref, license_note) ON p.k = r.provenance;
-- <<< fin de la graine générée de la douane
