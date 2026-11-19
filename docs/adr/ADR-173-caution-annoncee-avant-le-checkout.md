# ADR-173 — Caution annoncée avant le checkout (fiche S03, cartes) : même décision que le checkout, stade PRE_CHECKOUT

- **Statut** : PROPOSÉ (US-701 partie 701c, agent de story argent, claude-opus-5-5, 2026-11-18). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; argent, RLS / rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Complète** : ADR-169 (caution figée au checkout ; sa suite « fiche et cartes de recherche sur `deposit_amount` », S-9 de la passation d'US-701, BOARD N-372 et N-89), ADR-108 (caution conditionnelle « comme Turo »), ADR-131 (cartes de la recherche, US-203), ADR-138 (conditions de la fiche, US-205).
- **Sources** : 08 BR-PAY-06 (« Moment de l'évaluation » : avant le checkout, seuls `COUNTRY` et `CLASS` ; « Fail-closed » ; « Montant unique » et « Source unique du montant » : `deposit_amount[pays][classe]`, `catalog_deposit_policy.amount_minor` n'est plus lu), vecteurs T70 c, T72 c, T73 ; 16 SRC-011, PAY-011 (T70 c) ; 19 US-701 (T70 c) ; 10b UX-21 ; oracle `docs/specs/tools/check_t49plus.py`.

## Contexte

Après #242 (ADR-169), le checkout décide la caution par `deposit_amount[pays][classe]` ; la fiche et les cartes lisaient encore `catalog_deposit_policy` (migrations 0105, 0118), vide en production : elles affichaient toujours la mention générique, y compris pour un LUXE que S05 refuse (`PARAM_MISSING` tant que le montant est À DÉCIDER). 08 exige la même règle aux deux moments, restreinte avant le checkout aux déclencheurs connus du véhicule.

## Décision

1. **Une seule décision, celle de PAY.** `preCheckoutDeposit` (PAY, exportée par `index.ts`) appelle `evaluateDepositTriggers(…, 'PRE_CHECKOUT')` puis `depositAmountFor`, les fonctions de la porte du checkout ; `PreCheckoutDepositReader` lit les paramètres du pays par `PgDepositRailConfigReader` (le lecteur du checkout, sous `app_api`, à `platform.now()`), sans compte marchand (les rails dépendent des dates et de la carte : ils restent au checkout). Aucune règle n'est recopiée en SQL ni dans CAT.
2. **Trois issues** rendues au visiteur, rien d'autre : `GENERIC` (aucun déclencheur du véhicule : mention générique), `REQUIRED` (montant), `UNAVAILABLE` (déclencheur vrai, montant absent : la porte du checkout refusera avant le paiement). Paramètre absent ou classe inconnue ⇒ déclencheur vrai (fail-closed) ; `AGE` et `RISK` jamais évalués à ce stade.
3. **La base ne rend que la base de la décision** : `core.catalog_public_deposit_basis(uuid[])` (migration 0151 ; `SECURITY DEFINER`, propriétaire `catalog_cmd_owner`, `search_path` figé, liste blanche RLS-15, EXECUTE au seul `app_api`) : pays, devise et classe de valeur du catalogue des annonces LISTED, 50 au plus. Ni `app_anon` ni `app_worker` ; aucune colonne personnelle ni [C2].
4. **CAT ne dépend pas de PAY** (17 §2.2) : port `ListingDepositPolicy` de CAT, satisfait par `main.ts` (adaptateur de `PreCheckoutDepositReader`) comme le prix (PRC) et les notes (REV) ; sans politique : 503 (fail-closed). Une décision par pays et classe et par requête ; annonce retirée entre-temps : classe inconnue ⇒ `UNAVAILABLE`, jamais la mention générique.
5. **API** (ajouts seulement, l'API N-1 et le site N-1 restent compatibles) : `depositStatus` (`DepositNoticeStatus` : `GENERIC`, `REQUIRED`, `UNAVAILABLE`) sur chaque carte de `GET /search` et dans `GET /listings/{id}/conditions` ; `depositAmountMinor` et `deposit` gardent leur forme (montant seulement si `REQUIRED`). Jamais la classe ni un déclencheur.
6. **Site** : fiche S03 et cartes S01 / S02 : montant (`web.search.deposit.amount`), mention générique (`web.search.deposit.maybe`) ou caution non disponible avec **le texte de S05** (`web.deposit.unavailableNone`, quatre langues, US-701) : aucun texte nouveau, aucun catalogue nouveau. Statut incohérent avec le montant ⇒ réponse illisible (rien promis) ; statut absent (API N-1) ⇒ déduit du montant.

## Options écartées

- Réécrire `deposit_amount_minor` de `catalog_public_cards` / `catalog_public_terms` en SQL d'après les paramètres : la règle (fail-closed, classes, montant) existerait deux fois.
- Rendre la classe au site et décider dans le navigateur : la classe ne doit pas sortir de l'API (BR-PAY-06 : le voyageur ne voit que le montant).
- Mention générique quand le montant manque : elle annoncerait « peut-être » ce que S05 refusera ensuite (incohérence entre la fiche et le paiement).

## Conséquences

- Au PA et au PY aujourd'hui (graine 0142, `deposit_amount` À DÉCIDER) : STANDARD et PREMIUM ⇒ mention générique ; LUXE (et classe inconnue) ⇒ « caution non disponible », comme S05. Aucun montant inventé, aucun interrupteur touché.
- Expand seulement : `catalog_public_cards` (0105) et `catalog_public_terms` (0118) gardent `deposit_amount_minor` pour l'API N-1 ; l'API N ne le lit plus. Suite S-13 : migration de contraction (colonne, lecture de `catalog_deposit_policy` par catalog_cmd_owner) et contrat de location (0122), qui lit encore `catalog_deposit_policy` pour sa clause « Caution par carte » (à aligner sur `deposit_hold`).
- Preuves : `pay/internal/deposit-notice.test.ts` (T70 c, T72 c, T73, cohérence avec la porte du checkout, PA et PY), `cat/testing/search.contract.test.ts` et `listing-page.contract.test.ts` (OpenAPI, statut, aucune classe, 503), `apps/api/test/int/deposit-notice.int.test.ts` (chaîne réelle sous `app_api`, PA et PY), `packages/db/test/l0/l0-us701c-deposit-basis.test.ts` (rôles de production, PA et PY), `apps/web/account/search.test.ts`, `listing-terms.test.ts`, e2e `deposit-notice.spec.ts` (360 px, quatre langues).
