# ADR-129 — Trip fee du voyageur : ligne calculée par le moteur `prc.quote/2` et rejouée par la base

- **Statut** : PROPOSÉ (US-704, agent back-end, claude-opus-5-5, 2026-11-15). Migration 0101, fixture 9989, catalogue v44. Complète ADR-125.
- **Sources** : 19 US-704 ; 16 PRC-012 ; 08 BR-PRICE-06 (recommandation [NOUS], appliquée telle quelle : Q-004), E7 (jambes), T03, TJ01, TJ02a ; 17 §7.2 (`trip_fee_schedule`, failMode BLOCK) ; DEC-FONDATEUR-14 ; suivi des revues d'US-202 (orchestrateur, 2026-11-15) ; pré-mortem du lot 2 (L2-PM-03, L2-PM-06, L2-PM-14, L2-PM-27).

## Contexte

Le trip fee (F) est le revenu de Kmino sur chaque trip, comme chez Turo (DEC-FONDATEUR-14). Le paramètre `trip_fee_schedule` existe dans CFG depuis US-013 (PA et PY : 15 % jusqu'à 6 jours, 12 % de 7 à 29 jours, 8 % à partir de 30 jours, minimum de 5 USD ou de 35 000 PYG ; PROPOSÉ, OQ-MK-01). Avec `prc.quote/1` (US-202), `TRIP_FEE` était une **entrée** du moteur, et la commande `core.pricing_cmd_freeze_quote` ne rejouait que `TRIP_PRICE` : elle reprenait la ligne `TRIP_FEE` de l'API telle quelle. Une API compromise ou boguée pouvait donc figer un trip fee arbitraire (L2-PM-03, L2-PM-06).

## Décision

1. **Moteur `prc.quote/2`** : `TRIP_FEE` devient une ligne **calculée**, comme `TRIP_PRICE`. Elle n'est jamais fournie par l'appelant (`QUOTE_INPUT_INVALID` dans l'API, `QUOTE_MISMATCH` en base). Le changement du calcul change la version (ADR-125, point 1).
2. **Formule** (`tripFeeOf`) : F = max(roundHalfUp(P × taux), minimum). Le taux est celui de la **première tranche** dont `maxDays` couvre les **jours facturables** (`null` = sans borne, admis en dernière tranche seulement). L'assiette est le prix du trip P (prix après remises, 08 BR-PRICE-05) : les lignes promotionnelles ne la changent pas (vecteurs N et NP de 08 E7). L'arrondi est `multiplyRoundHalfUp` de `@rueda/money`, et la borne `max` vient de la même API. Les facteurs « anticipation » et « classe » de la formule cible de BR-PRICE-06 ne sont pas construits : le MVP de 08 ne retient que la durée (PROPOSÉ).
3. **Barème fail-closed** : barème absent, aucune tranche, bornes non entières ou non croissantes, `null` avant la dernière tranche, taux hors de [0 ; 10 000] pb, minimum négatif, d'une autre devise ou absent, ou durée non couverte ⇒ `QUOTE_UNAVAILABLE`. On ne retombe jamais sur un trip fee nul.
4. **Jambe** : F et sa taxe vont **entièrement** à `PLATFORM`, comme complément du moteur de règlement de 08 E7. F n'entre jamais dans `HOST` (08 A02 : la part de l'hôte porte sur P seul) ni dans `INSURER`. La taxe sur F suit `tax_line_config` (ITBMS / IVA, `third_party` = `false` : c'est une dette propre de Kmino). En cas d'annulation, F est retenu ligne par ligne (`retenu(F)`, T03 : 6,00).
5. **Rejeu par la base** (migration 0101) : la fonction pure `core.pricing_trip_fee(P, jours, barème)` (SECURITY INVOKER, EXECUTE au seul `cmd_money_owner`) applique la même arithmétique (`settlement_verify_round` de 0054). `core.pricing_cmd_freeze_quote` est remplacée par `CREATE OR REPLACE` (même signature, propriétaire et droits). Elle lit `trip_fee_schedule` **en vigueur en base** à `platform.now()` (politique `cmd_money_quote_read` élargie à cette clé), recalcule F, puis compare les lignes, la taxe, le total et les jambes de l'API. Tout écart ⇒ `QUOTE_MISMATCH`, et rien n'est écrit. La commande ne fige plus que `prc.quote/2`. La contrainte `pricing_quote_engine_known` admet `/1` et `/2` (expand-only).
6. **Instantané** : le barème entre dans l'instantané figé des paramètres (`tripFeeSchedule`). Un barème modifié après la réservation ne change donc pas un devis figé (BR-MOD-06).
7. **Affichage** : la ligne « trip fee » du détail du prix (10b UX-17) porte une explication courte sous son libellé (`PriceLine.hint`, jetons de thème). Les textes `common.quote.line.tripFee` et `common.quote.line.tripFeeHint` existent en es, en, fr et pt-BR, avec le tutoiement en français (UX-12). Ils sont rédigés pour Kmino, sans aucun texte repris de Turo.

## Conséquences

- US-208 (route du devis) n'envoie que la demande sans `TRIP_FEE`. US-226 (protections) et US-223 (paiement par jambes) partent d'un devis dont F est contrôlé par la base.
- Aucun devis `prc.quote/1` n'a été figé hors des tests : aucune route n'existait avant US-208. Le rejeu TS d'un devis `/1` échouerait (`QUOTE_REPLAY_MISMATCH`). Si un tel devis devait un jour exister, il faudrait un rejeu par version (PROPOSÉ, non construit).
- Facturer le consommateur avant la mise en service suppose l'avis OQ-MK-01 (DEC-FONDATEUR-02). Cet avis bloque la mise en service, pas le build. Les valeurs du barème restent PROPOSÉES (décision au jalon J-ADM-031).
- Le PRC et la base calculent F deux fois, par conception (ADR-125) : un écart refuse le devis et ne le corrige jamais.

## Alternatives écartées

- **Garder F en entrée et le borner en base** : la borne laisserait passer un F faux mais plausible (L2-PM-06).
- **Comparer F à la valeur de la demande** : la demande vient de l'API, donc la comparaison ne contrôlerait rien.
- **F nul si le barème manque** : ce serait une perte silencieuse de revenu et un devis différent entre pays. Le paramètre est en failMode BLOCK.
- **F sur P + promotions** : contraire à 08 (N, NP : F = 15 % de P avant la promotion).
