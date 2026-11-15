# Revue architecture — US-201 « recherche par zone, lieu, dates et heures » (PR n° 163) — 2026-11-15

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : da4c5c78..3f1bea4a

Contexte : troisième revue (précédente : APPROUVÉ au SHA 6c714ce1 / d7730d35). Delta propre à la branche lu depuis 6e2d7e70 (`git diff 6e2d7e70 3f1bea4a`) : `playwright.config.ts`, commentaire de `e2e/visual.ts`, 49 PNG de référence, passation, `REGRESSION_VISUELLE.md`, changelog. Justesse de la fusion de main vérifiée : hors PNG et documents du delta, le contenu d'US-201 (`da4c5c78..3f1bea4a`) est identique ligne à ligne à celui déjà revu (`734248df..d7730d35`) ; seules les lignes du delta diffèrent. Deux runs verts hors job revues (43770688412, 43772110845).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                  |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | MINEUR  | Fusion de main juste : la migration `0103_catalog_public_search.sql` suit `0102_pricing_trip_fee.sql` de main sans collision ni trou ; `schema.md`, `modules.md`, `api.md` et `docs/team/review-requirements.json` n'ont pas dérivé (aucun écart hors contenu US-201 déjà revu).                                         |
| 2   | MINEUR  | Aucun fichier du code produit (apps/api, packages, pages et composants web) n'est touché par le delta : seuls la configuration des e2e, un commentaire, des références PNG et de la documentation. Le périmètre de la documentation (passation, guide de régression visuelle, changelog) est cohérent avec le correctif. |
| 3   | MINEUR  | Les 49 PNG reprises (accueil 7, vitrine 7, console 35) sont toutes sous `__screenshots__/linux/`, la référence faisant foi ; aucune capture `win32` ou `darwin`, aucun autre type de fichier binaire.                                                                                                                    |

Verdict : APPROUVÉ
