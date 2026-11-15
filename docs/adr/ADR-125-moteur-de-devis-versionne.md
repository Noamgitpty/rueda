# ADR-125 — Moteur de devis versionné : fonction pure, taxe par ligne, jambes de capture, rejeu du devis figé

- **Statut** : PROPOSÉ (US-202, agent back-end, claude-opus-5-5, 2026-11-14 ; complété le 2026-11-15 : persistance). Migration 0099, fixture 9993, catalogue v42.
- **Sources** : 19 US-202 ; 16 PRC-025, PRC-020, TA01, TA07 ; 17 §2.6, §3.2.5 ; 08 BR-PRICE-12, BR-PRICE-13, BR-PRICE-14, BR-MOD-06, E7, vecteurs T01–T48 et TJ ; pré-mortem du lot 2 (L2-PM-03, L2-PM-12 à L2-PM-15) ; ADR-009 (primitives monétaires), ADR-049 (configuration pays).

## Contexte

Le devis est le seul calcul de prix : affichage (recherche, fiche, checkout), contrat, remboursements et jambes en partent (17 §2.6). Il doit être exact à l'unité mineure en USD (exposant 2) et en PYG (exposant 0), sans constante de pays, et rejouable à l'identique (NFR-17). Le moteur de règlement de `@rueda/money` (US-016 à US-018) existe déjà et calcule les jambes ; la configuration fiscale du pays existe dans CFG (US-013, `tax_line_config`).

## Décision

1. **Fonction pure et versionnée** `computeQuote(request, params)` dans le module PRC (`prc.quote/1`). Aucune horloge, aucune base, aucune configuration lue à l'intérieur : l'appelant passe l'instant serveur et l'instantané des paramètres (`QuoteParams`). Toute évolution du calcul change la version.
2. **Une seule fonction des jours facturables**, `billableDays = max(1, ceil((fin − début − grace_minutes) / 24 h))`, sur des instants en millisecondes et en `bigint` : blocs de 24 h exactes, indépendants du fuseau et des changements d'heure (comme Turo, BR-BOOK-03 : « tranche de 24 h entamée = 1 jour », INFÉRÉ ; `docs/team/COMME_TURO.md`). La tolérance est le paramètre `grace_minutes` du pays (OQ-BR-04).
3. **Prix du trip** = prix journalier de l'annonce × jours facturables (`multiplyByInteger`). Les autres lignes (`TRIP_FEE` d'US-704, `PROTECTION` d'US-226, livraison, Extras…) sont des entrées chiffrées par leur story ; `TRIP_PRICE` n'est jamais fourni par l'appelant. Le client n'envoie aucun montant (L2-PM-03).
4. **Taxe par ligne** : `multiplyRoundHalfUp(ligne, taux du groupe)` puis somme par groupe fiscal (T43). Taux exact (`rateBps / 10 000`). Lignes promotionnelles négatives taxées de même. Contrôle fail-closed de la configuration : ligne non nulle sans règle, groupe à deux taux ou à deux valeurs de `third_party`, ligne taxable sans taux ⇒ `TAX_CONFIG_MISSING`.
5. **Jambes** : celles de la capture du total, calculées par `computeCaptureLegs` de `@rueda/money` (même `allocHost`, même règle de complément) sur le trip tiré du devis (`quoteSettlementTrip`). Le groupe `third_party` = `true` forme `TAX_THIRD_PARTY` ; défaut `false` (dette propre de Kmino, `PLATFORM`). Jambe négative ⇒ `LEG_AMOUNT_NEGATIVE`, aucun devis. Une part d'assureur absente alors qu'une ligne de protection ou d'assistance est non nulle ⇒ `QUOTE_UNAVAILABLE` (jamais 0). Le même trip alimente le règlement d'annulation : T01–T27 se rejouent depuis le devis.
6. **Instantané des paramètres** `resolveQuoteParams` (CFG) : devise, `grace_minutes`, `max_trip_days` (au-delà ⇒ `QUOTE_UNAVAILABLE`, borne du devis), `tax_line_config`, `host_share_pct[plan]` (plan de l'hôte, sinon `host_default_plan`), parts de livraison et d'Extras (absentes ⇒ part de l'hôte), parts de l'assureur (contrat ; absentes ⇒ non figées). Paramètre manquant ⇒ `QUOTE_UNAVAILABLE`.
7. **Devis figé** (`freezeQuote`) : entrées et instantané en JSON canonique (`canonicalJson`, clés triées, montants en texte) avec empreinte `SHA-256("rueda.quote.inputs/1\n" ‖ entrées)`, sorties canoniques avec leur empreinte. **Rejeu** (`replayFrozenQuote`) : recalcul depuis les seules entrées figées, sorties exigées identiques ; sinon `QUOTE_REPLAY_MISMATCH`. Les empreintes servent à l'intégrité et à la traçabilité, pas à l'authentification : la protection contre l'écriture reste celle de la base (RLS, commandes).
8. **Persistance (migration 0099)** : seul le devis FIGÉ est stocké (le PROVISIONAL n'est qu'affiché). Tables `core.pricing_quote` (entrées, sorties, empreintes, montants), `core.pricing_quote_line`, `core.pricing_trip_price_version` ; RLS `ENABLE` + `FORCE`, **aucun droit** des rôles applicatifs ; registres immuables (seule transition `FROZEN` → `SUPERSEDED`, tout rôle). Écriture par deux commandes `SECURITY DEFINER` de `cmd_money_owner`, EXECUTE `app_api` :
   - `pricing_cmd_freeze_quote` **rejoue** le devis avec la configuration de la base (prix journalier de l'annonce LISTED, `grace_minutes`, `max_trip_days`, part du plan par défaut, `tax_line_config` en vigueur) et l'arithmétique du vérificateur de 0054 (`settlement_verify_round`, `settlement_verify_host_from_guest`) ; empreinte fausse ou sortie différente ⇒ `QUOTE_MISMATCH`, rien d'écrit (L2-PM-03 : « total recalculé en base ») ; protection et assistance refusées (`QUOTE_UNAVAILABLE`) tant que la part de l'assureur et le niveau de protection ne sont pas fixés (US-226) ; période passée refusée ;
   - `pricing_cmd_version_trip_price` rattache un devis figé du voyageur à son trip (verrou du trip, même pays, devise, annonce et période), version suivante, devis précédent `SUPERSEDED` (BR-MOD-06).
9. **Pas de route HTTP dans PRC** : une route de devis est une route de réservation (`TermsGuard`, US-102) et PRC ne dépend que de CAT et CFG (17 §2.2). La route est portée par le checkout (US-208, AVL) ; PRC livre `QuoteService`, `PgQuoteStore`, `QUOTE_MESSAGES` et les textes `common.quote.*` (es, en, fr, pt-BR).
10. **Codes PROPOSÉS** : `QUOTE_INPUT_INVALID`, `QUOTE_REPLAY_MISMATCH`, `QUOTE_MISMATCH`, `QUOTE_NOT_FOUND`, `TRIP_NOT_FOUND` (à reporter en 16 A.8 par une demande de fusion revue).

## Conséquences

- US-203, US-208, US-226, US-704 et US-223 appellent `QuoteService` ; le montant encaissé se borne au `total` du devis figé (RC4, US-223).
- Deux calculs du même devis, par conception : le moteur de l'API (source) et le rejeu de la base (contrôle), sur les mêmes définitions de 08 ; un écart refuse le devis, il ne le corrige jamais.
- US-226 lèvera le refus de la protection dans la commande (part de l'assureur par niveau) ; US-208 portera la route et le rattachement à la conversion.
- Un changement de taux, de tolérance ou de plan ne touche jamais un devis figé (BR-MOD-06 : une modification crée une nouvelle version).

## Alternatives écartées

- **Taxe sur la base agrégée** : contraire à 08 (T43 : 1,41 au lieu de 1,40).
- **Jours comptés en dates locales** : dépend du fuseau et des changements d'heure ; Turo compte des tranches de 24 h.
- **Jambes recalculées dans PRC** : deux calculs possibles d'une même jambe ; le moteur de règlement de `@rueda/money` reste l'unique source (08 E7).
- **Rejeu par comparaison au seul total** : ne détecte pas une jambe ou une taxe déplacée à total constant.
