# ADR-167 — Écrans des gains de l'hôte (A08) et du reçu du voyageur (S09 · reçu) ; alignement des reçus sur ADR-161

- **Statut** : PROPOSÉ (US-217 partie 217b, agent de story, claude-opus-5-5, 2026-11-18). Revues exigées : celles de `check-story-reviews.mjs` ; argent, `SECURITY DEFINER` sur un autre modèle que l'auteur. À reporter dans 10b (A08, S09 · reçu) et 16 A.8 (clés `earnedMinor`, `pendingMinor`).
- **Complète** : ADR-161 (reçus et relevé lus de l'état stocké, 217a), ADR-160 (S08 / S09), ADR-162 (positionnement d'intermédiaire), ADR-154 (S10 · remboursement).
- **Sources** : 19 US-217, US-214 (critère 2), US-212 (critère 3) ; 10b A08 / UX-45, S09, UX-51 ; 16 FIN-018, FIN-002 ; 08 E7 (règle 7), BR-CXL (« Taxes : méthode unique »), BR-PRICE-12, SM-8 ; revues de #231 (BOARD N-337 à N-340), passation d'US-212 (N-346).

## Contexte

Les revues de 217a (#231) ont relevé quatre écarts entre le contrat des routes et ce que les écrans allaient montrer : la taxe du trip fee était rendue en entier à côté d'un trip fee conservé en partie, alors qu'ADR-161, `POUR_LE_FONDATEUR.md` §4.7 bis et GL-38 disent qu'elle ne l'est pas (N-337) ; `refundMinor` est le remboursement **dû** par le règlement, pas un remboursement émis (N-338) ; le total mensuel additionnait des trips à venir ou en cours (N-339) ; un trip avec devis mais sans capture rendait au voyageur un « total payé » lu du devis, alors que l'hôte recevait 409 (N-340). US-212 attend aussi, sur le reçu, la mention d'intermédiaire et l'hôte en prénom et initiale (N-346).

## Décision

1. **Taxe du trip fee (N-337)** : la taxe de ligne du devis figé n'est rendue (`taxMinor`, `taxRateBps`) que si rien du trip fee n'est remboursé ; dès qu'une part l'est, les deux valent `null`. 08 rembourse la taxe une fois par **groupe** fiscal (prorata de la base taxable remboursée), jamais par ligne : la taxe du trip fee conservé n'existe dans aucun état stocké et attend OQ-BR-14. L'écran dit qu'elle figure sur la facture émise à part. Migration 0144 (`core.finance_trip_receipt_view` remplacée à signature et droits identiques).
2. **Aucun reçu deviné (N-340)** : sans règlement ni solde capturé, la vue GUEST rend `NULL` (`NO_RECEIPT`, 409 `RECEIPT_NOT_READY`), comme la vue HOST ; le total payé est celui du règlement en tête ou la somme capturée, jamais le total du devis.
3. **Acquis et à venir (N-339)** : le relevé du mois gagne deux sommes par devise, `earnedMinor` (jambes HOST des versions en tête des règlements et ajustements du `host_ledger`) et `pendingMinor` (jambes HOST capturées d'un trip sans règlement : à venir, en cours, ou terminé et pas encore réglé). `hostLegMinor`, `adjustmentsMinor`, `netMinor` (= `earnedMinor` + `pendingMinor`), `tripsCount` et les lignes ne changent pas. A08 montre « Ganado » et « Por liquidar » séparés, jamais leur somme (PROPOSÉ ; comme Turo, qui sépare les gains à venir des gains versés).
4. **Remboursement dû (N-338)** : la clé `refundMinor` reste (contrat de 217a) ; OpenAPI la décrit comme le dû du règlement, l'écran la libelle « Reembolso que te corresponde » et renvoie à S10 (`/trips/{id}/refund`) pour l'état et la date d'émission (SM-8). Jamais « te devolvimos » sur le reçu.
5. **S09 · reçu** (`/trips/{id}/receipt`, lié depuis S09 dès que le paiement existe) : total payé à Kmino, trip fee facturé et sa taxe de ligne, part remboursée et part conservée, remboursement dû ; mention d'intermédiaire entre particuliers avec l'hôte en prénom et initiale (lu de `GET /trips/{id}`, N-346) ; « reçu sans valeur fiscale ; la facture électronique est envoyée à part » (défaut fail-closed : aucune entité émettrice ni mention fiscale tant qu'ADR-013 / OQ-MK-06 ne sont pas tranchées). 409 : « pas encore disponible » ; 404 : même message pour un reçu d'autrui ou inconnu.
6. **A08** (`/host/earnings?org=&month=`, lié depuis l'espace hôte A10) : relevé d'un mois (mois courant UTC par défaut, mois voisins en liens) ; par devise, acquis et à régler ; une carte par trip (prix sur lequel la part est calculée, commission de Kmino, part de l'hôte avec le nom du plan et le pourcentage figé, état réglé ou à régler, lien vers le trip) et chaque pénalité sur une carte à part (08 E7 règle 7). `web.a08.payoutsOff` toujours affiché : `payouts_enabled` vaut `false` et aucune date ni statut de versement n'existe encore (`web.a08.payoutOn`, `web.a08.status.*` : suite, GL-44).
7. **Montants** : lus de l'API (texte, `bigint` pour l'affichage seulement), jamais recalculés ni additionnés à l'écran ; PYG sans décimale (exposant de la devise rendu par l'API). Le pourcentage du plan est un affichage de la fraction figée (`3/4` ⇒ 75 %), jamais multiplié par un montant.
8. **Pas de PDF** : 10b UX-51 admet « un HTML accessible équivalent » pour les documents générés ; le reçu et le relevé sont des pages HTML accessibles (axe sans violation, quatre langues). Un PDF reste une suite si la recette le demande.

## Alternatives écartées

- **Renommer `refundMinor` en `refundDueMinor`** : contrat de 217a déjà publié ; le sens est porté par OpenAPI et le libellé. Lire l'émis de l'instance SM-8 dans le reçu doublerait S10, qui le montre déjà avec la date d'émission.
- **Ventiler la taxe retenue par ligne** (`roundHalfUp(F conservé × taux)`) : recalcul interdit et décision fiscale (OQ-BR-14).
- **Sommer « acquis » et « à venir » dans le site** à partir des lignes : un calcul d'argent hors de la base ; les deux sommes viennent de la base.
- **Limiter le relevé aux trips terminés** : l'hôte ne verrait plus ce qui arrive ; Turo montre les gains à venir à part.

## Conséquences

- Migration 0144 (deux corps remplacés, aucune table ni droit) ; le relevé gagne deux clés : l'API 217a les refuserait (503, fail-closed) entre la migration et le déploiement de l'API 217b.
- Catalogue v83 : `web.s09.receipt.*`, `web.s09.documents.receiptOpen`, `web.a08.*`, `web.host.earningsLink` ; `web.a08.title`, `web.a08.empty`, `web.a08.payoutsOff` deviennent officielles (retirées du prototype).
- e2e `trip-receipt.spec.ts` (360 px, es) et deux écrans de plus dans `screens.spec.ts` (`recu-voyage`, `hote-gains`) ; références visuelles tirées de l'artefact CI `regression-visuelle`.
- Suites : dates et statuts de versement sur A08 avant `payouts_enabled` (GL-44) ; PDF du reçu si demandé ; relevé annuel (US-541) ; accès au reçu jugé sur le rôle `P2P_HOST` `ACTIVE` et co-hôtes (N-342) ; `TRIP_SETTLED_TOTAL` hors MIT et prolongations (N-341).
