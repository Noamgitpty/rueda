# ADR-090 — Montants payables d'un trip et bornes du remboursement (refus fail-closed)

- **Statut** : PROPOSÉ (correctif US-042, agent argent, claude-opus-5-5, 2026-11-06). Revues exigées : code, **argent** et qa (`packages/money/`), sur un autre modèle que l'auteur. Nouveaux codes à reporter au catalogue de 16 A.8 par une demande de fusion sur `docs/specs/`.
- **Sources** : 08 pseudo-code BR-CXL (`LINES` : « promoPlatform ≤ 0 et promoHost ≤ 0 ») ; 08 BR-PAY-07 (codes promo « sur le prix du véhicule seulement ») ; 08 E7 règle 5 (code promo trop fort « refusé au checkout ») ; 08 E1, invariants (`refund_committed ≤ collected_total`, taxe remboursée ≤ taxe payée) ; 08 VERIF_09-m02 (« promo à 100 % », base taxable nulle) ; oracle `docs/specs/tools/independent_settlement_check.py` (fuzz : `assert 0 <= o['guest'] <= t['total']`). Complète ADR-054 (moteur bêta) et ADR-076 (propriétés).

## Contexte

Le job « qualité » de la PR #93 (run 42167466075) a échoué dans `test/settlement/properties.test.ts`, cas PY, graine fast-check `-1390209851`. Le contre-exemple : P 864 211, promo plateforme −2, promo hôte −864 210, total payé **−1**, `GUEST_NO_SHOW`. Le moteur l'acceptait et rendait un remboursement de 0, supérieur au total payé. Les générateurs bornaient chaque promo par P, mais pas leur somme.

Évaluée par l'oracle (`mk_trip`, `compute`), la même entrée rend un total de −1, un remboursement de 0 et des gains hôte de −864 210. Elle viole donc l'invariant `0 ≤ guest ≤ total` du fuzz de l'oracle : elle est hors du domaine de 08.

En rejouant la propriété avec d'autres graines, on a trouvé deux autres cas, eux aussi présents sur `main`. Ils sont au bord du domaine, quand P + promos est très petit :

- graine `-1970700454` : P 3, promo hôte −3, F 1, taxe figée 1, `PLATFORM_INCOMPLETE_STEPS`. La retenue est arrondie ligne par ligne (`roundHalfUp`, égalité vers +∞). Le remboursement HT vaut alors −1 et la taxe remboursée −1 : l'oracle rend lui aussi −2 ;
- graine `-1546341607` : P 6, promos −3 et −3, F 1, 9 jours, no-show. La retenue HT vaut −1, le remboursement 2 et le total payé 1 : même résultat dans l'oracle.

Dans ces deux cas, la formule de 08 suivie à la lettre (et l'oracle) contredit l'invariant E1 de 08.

## Décision

1. **Garde d'entrée `assertPayableAmounts`** (`src/settlement/amounts.ts`, exportée par `@rueda/money`). Elle est appelée par `validateTrip` à l'entrée de `computeCancellationSettlement`, donc aussi par `buildSettlementRecord`. Le **moteur de devis** doit l'appeler avant de figer un devis : il n'existe pas encore, sa story le fera (critère à reporter dans la story du devis). La garde ne calcule aucun montant, elle compare des entrées :
   - `LINE_SIGN_INVALID` : promo > 0, ou ligne de prix < 0 (08 `LINES`) ;
   - `PROMO_EXCEEDS_TRIP_PRICE` : promo plateforme + promo hôte < −P (08 BR-PAY-07 et E7 règle 5). Une promo **égale** à P reste admise (08 VERIF_09-m02) ;
   - `TOTAL_PAID_NOT_POSITIVE` : total payé ≤ 0. Le cas **négatif** est tranché par 08 : E1 exige 0 ≤ remboursement ≤ encaissé, ce qui est impossible si l'encaissé est négatif. Le cas **nul** n'est pas tranché par 08 (le trip fee est nul à partir de 30 jours, BR-PRICE-06) : il est **refusé par défaut**, PROPOSÉ, voir **Q-013**.
2. **Bornes du remboursement** (`settle`, `src/settlement/cancellation.ts`). Sont refusés, avec le code `REFUND_OUT_OF_RANGE` : un remboursement hors de [0 ; total payé], ou une taxe remboursée d'un groupe hors de [0 ; taxe payée]. Le contrôle a lieu après le contrôle d'équilibre et avant les jambes. 08 ne dit pas comment arrondir la retenue des promos proches de 100 % : on refuse en fail-closed et le règlement part en revue FIN, comme pour E7 règle 5. PROPOSÉ, voir **Q-014**. Les options possibles sont un plancher à 0 avec un résidu à la plateforme, ou une retenue arrondie sur P + promos ensemble. Toutes deux exigent une révision de 08 et de l'oracle.
3. **Générateurs de propriétés**, alignés sur 08 :
   - `properties.test.ts` borne la somme des promos par P, une promo à 100 % comprise, et filtre les totaux > 0 ;
   - `monotonicity.properties.test.ts` et `oracle-diff.oracle.ts` filtrent les totaux > 0. Le domaine du second (PP ≥ −P/5, PH ≥ −P/10) n'atteint jamais `REFUND_OUT_OF_RANGE`.

   La propriété d'équilibre n'admet `REFUND_OUT_OF_RANGE` que dans la zone où les arrondis le permettent. Les lignes P, PP et PH sont arrondies chacune à ½ près, donc leur retenue HT est dans [s·r − 3/2 ; s·r + 3/2], avec s = P + promos et r = j / days ∈ [1/days ; ¾]. Le refus est donc impossible si s ≥ 6 et 2s ≥ 3·days ; partout ailleurs, la propriété échoue.

4. **Preuves**, dans `test/settlement/payable-amounts.test.ts` :
   - régressions déterministes des trois contre-exemples, en PYG et en USD, sur le règlement, sur la version persistée et sur la garde du devis ;
   - bornes de chaque code ;
   - propriétés de refus en PA et en PY (Σ promos > P ; total ≤ 0 ; signe des lignes) et propriété d'acceptation (Σ promos ≤ P et total > 0) ;
   - un test vérifie que l'échec d'une propriété fast-check imprime `seed:` et `path:` (le rejeu se fait avec `{ seed, path, endOnFailure: true }`).

## Conséquences

- Un trip hors des règles de 08 n'est plus réglé en silence, et un remboursement hors bornes n'est plus émis : il est refusé avec un code stable.
- `record.ts` n'est pas modifié : la garde passe par le moteur. Pas de conflit de contenu avec les PR #91 et #92, qui modifient `record.ts`. Les deux ajoutent aussi des questions à `QUESTIONS.md` (Q-012) : les numéros Q-013 et Q-014 ont été pris pour éviter la collision. Un conflit de lignes reste possible à la fin du tableau.
- L'oracle n'est pas modifié : il rend les mêmes montants que le moteur sur les trois cas, et ne modélise pas de refus. Son fuzz reste dans le domaine où ces refus sont impossibles. Une règle tranchée par Q-014 devra être portée dans 08 et l'oracle par une PR revue argent.
- La non-cumulabilité des codes promo (08 BR-PAY-07, contradiction OQ-BR-10 de BR-PRICE-16) n'est pas imposée par la garde : l'oracle et ses vecteurs combinent les deux promos.

## Alternatives écartées

- **Plancher à 0 du total ou du remboursement** : 08 ne le prévoit pas, et l'oracle ne le fait pas. Le moteur s'écarterait de l'oracle et créerait ou perdrait une unité sans écriture de contrepartie.
- **Corriger seulement le générateur** : cela masquerait l'instabilité au lieu de la corriger. Le moteur accepterait toujours un devis interdit.
- **Refuser les promos à 100 %** : 08 VERIF_09-m02 les cite comme possibles.
