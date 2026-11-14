-- 0095 — CAT : catalogue de la douane partagé entre les pays (N-101, suite de l'import de la douane ;
-- ADR-123, ADR-109 §5 ; 17 §3.2.3 ; revue architecture US-113 n° 4). Appliquée sous `migrator`, en
-- une transaction.
--
-- Pourquoi (PROPOSÉ, ADR-123 ; « comme Turo », COMME_TURO.md) : les 680 variantes sans fiche de
-- l'import (0079) portaient le marché de la SOURCE ; un hôte de l'autre pays ne voyait ni les 52
-- marques ni les 642 modèles venus de la douane, alors qu'un même modèle circule dans les deux pays
-- (occasion japonaise, marques chinoises) et que rien dans la donnée ne le rattache à un seul pays :
-- la douane dit qu'un modèle EXISTE, pas où il peut être loué. Le catalogue est donc commun
-- (`market` nul, comme toute la graine v1 de 0063) : un hôte de chaque pays trouve ces modèles au
-- même titre que ceux d'origine. Aucune raison métier contraire n'a été trouvée : la publication
-- reste gardée par le pays (interrupteurs, contrat de l'assureur, classe de valeur : N-83), jamais
-- par le marché d'une variante du catalogue.
--
-- Ce que fait la migration : une seule instruction, `market` rendu nul pour les variantes de la
-- source sans fiche qui en portaient un. Aucune autre colonne, aucun statut, aucune ligne ajoutée
-- ni retirée (comptes égaux) ; aucun code pays écrit ici (la ligne est désignée par sa source).
-- Dérogation `data-update` nominative : packages/db/expand-contract-allowlist.json.
--
-- Compatibilité (ADR-081) : la version N de l'API et les fonctions de 0067, 0074, 0077 et 0083
-- lisent déjà `market IS NULL` comme « commun à tous les pays » ; elles servent ces lignes sans
-- changement. Un véhicule déjà créé sur l'une d'elles dans le pays de la source reste valide.
--
-- Retour arrière (ADR-123) : rendre aux variantes le marché de la source par une migration revue
-- (même dérogation), SEULEMENT si aucun véhicule d'un autre pays ne les référence ; sinon retirer
-- les variantes concernées (`status = 'RETIRED'`, jamais de DELETE : garde de 0063) ou garder le
-- partage. Preuves : test/l0/l0-n101-catalogue-pa.test.ts (sous app_api, PA et PY) ;
-- test-migrations/9953 (sous migrator : retour arrière de l'import).

UPDATE core.catalog_vehicle_variant
   SET market = NULL
 WHERE source = 'DNIT_ADUANAS_PY'
   AND market IS NOT NULL;

COMMENT ON COLUMN core.catalog_vehicle_variant.market IS
  'Pays où la variante est proposée ; NULL = commune à tous les pays (17 §3.2.3). Les variantes de '
  'l''import de la douane sont communes depuis 0095 (N-101, ADR-123) : la source dit qu''un modèle '
  'existe, pas où il se loue.';
