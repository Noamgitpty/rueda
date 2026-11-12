# Passation US-113 (suite) — Import de la douane au catalogue des véhicules (2026-11-12, agent back-end, claude-opus-5-5)

Branche `story/US-113-import-douane`, partie d'`origin/main` (672d529), worktree `../wt/US-113-import-douane`. PR en brouillon. **Statut : EN REVUE**. Décision : ADR-109 (PROPOSÉ).

- **Fait** :
  - Données : `apps/api/src/modules/cat/data/vehicle-catalog-dnit.json`, produit par `scripts/catalog/dnit-import.mjs` depuis la liste normalisée du rapport d'analyse (seuil 30 unités, 758 modèles) : **52 marques et 642 modèles nouveaux, 680 variantes sans fiche** ; 14 marques et 43 modèles de la v1 rattachés sans être recréés (doublons évités), dont 38 complétés par une variante des années antérieures ; 40 libellés écartés, 35 rapprochements (ADR-109 §7).
  - Migration **0078** (expand) : source `DNIT_ADUANAS_PY` ; fiche technique facultative pour cette seule source (`*_specs_complete`) ; graine générée par `customs-import.ts` (provenance jointe, licence sur chaque ligne). Liste blanche pays : 0078 (marché de la source).
  - API : `prefill` sans valeur devinée (`specsComplete`), `listMakes` / `listModels` filtrés par le marché du compte d'hôte ; console : « fiche à compléter » (`backoffice.catalog.specsPending`, catalogue i18n **v27**, quatre langues).
  - Tests : `customs-import.test.ts`, `vehicle-catalog.service.test.ts`, `vehicle-catalog.int.test.ts` (PA, PY), `l0-us113-customs-import.test.ts`, fixture **9981** (9980 était déjà pris par US-107), `l0-us113-vehicle-catalog.test.ts` adapté, `ops-view.test.tsx`.
  - Docs : ADR-109, README CAT et `packages/db`, `ENV_VARS.md`, `COMME_TURO.md`, fragment de CHANGELOG.
- **Reste** :
  - **Report à faire dans `docs/specs/`** (PR revue, non faite ici) : `sources/SRC_VEHICLE_DATA.md` (source douane, licence, méthode) et 17 §3.2.3 (valeur `DNIT_ADUANAS_PY`, colonnes facultatives pour une source sans fiche).
  - Fiches techniques à compléter par l'ops (priorité au champ `units`) ; alias de la v1 non enrichis (Starex, Strada, Triton, Axela, T7, Morning : `UPDATE` = dérogation) ; APPROVE de 0074 sur un modèle de la douane ne complète pas sa carrosserie.
  - 100 % du parc : demande au Registro de Automotores (parc inscrit, surtout avant 1997 / 2000, nomenclature), modèles de 10 à 29 unités après revue ; Panama sans source équivalente.
- **Prochaine commande exacte** : `RUEDA_WRITE_CATALOG_SEED=1 pnpm --filter @rueda/api exec vitest run src/modules/cat` après toute modification des données (avant application en environnement partagé).
- **Pièges** : `numbering.test.ts` échoue tant que 0076 et 0077 ne sont pas sur main (attendu) ; renuméroter 0078 si une autre migration passe avant (regénérer la section : le nom du fichier est dans `CUSTOMS_MIGRATION_FILE`). Un nom de fichier contenant « -py- » déclenche le lint pays (d'où `dnit-import.mjs`). `docs/architecture/schema.md` régénéré depuis le journal de la CI (pas de PostgreSQL local).
- **Revues exigées** : code, architecture, qa (story US-113) ; architecture et **sécurité** (`packages/db/`), sur un autre modèle. Chemins : `packages/db/`, `packages/i18n/` (US-113 propriétaire) ; aucun chemin protégé.
