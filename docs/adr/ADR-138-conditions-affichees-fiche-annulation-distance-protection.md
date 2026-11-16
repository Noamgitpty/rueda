# ADR-138 — Conditions affichées sur la fiche : annulation en dates, distance de la période, protection de l'assureur partenaire lue du contrat, RC au minimum du pays

- **Statut** : PROPOSÉ (US-205, partie 205a, agents back-end et front-end, claude-opus-5-5, 2026-11-16). Revues exigées : voir `check-story-reviews.mjs` (story US-205) ; RLS, rôles et `SECURITY DEFINER` sur un autre modèle que l'auteur.
- **Sources** : 19 US-205 (critères 1 à 4) ; 16 LST-010, LST-012, LST-013, PRT-003 / PRT-013 ; 08 BR-CXL-01 (formulation exécutable), BR-CXL-06, BR-MILEAGE-01, BR-PROT-01, BR-PROT-03, BR-PROT-04, BR-PAY-06 ; 17 §0.1, §2.4, §3.2.13 ; 10b S03, UX-21, UX-54 ; 22 OQ-P2P-03, OQ-BR-16, OQ-BR-30 ; pré-mortem du lot 2 L2-PM-08 ; ADR-111 (contrat de l'assureur), ADR-131 (caution des cartes), ADR-132 (fiche), ADR-136 (niveaux de protection).

## Contexte

La fiche S03 (US-204, US-208) montrait le véhicule, l'hôte, les dates et le prix final, mais aucune condition : ni la date limite d'annulation gratuite, ni la distance incluse sur la période, ni ce que la protection couvre. Le contrat de l'assureur partenaire (`settlement_insurer_contract`, US-108) ne portait que les critères d'éligibilité du véhicule : ni RC, ni franchise, ni exclusion. 19 US-205 exige que la fiche dise, en dates claires, ce qui est gratuit jusqu'à quand, combien de km sont inclus, qui assure, la RC tiers, les franchises et les exclusions, **identiques au contrat de location** (US-211), et qu'aucune couverture ne soit promise quand `insurer_contract_active[pays]` est `false`.

## Décision

1. **Conditions du contrat de l'assureur, versionnées** (migration `0115`) : colonnes ajoutées à `settlement_insurer_contract` (`broker_id`, `currency`, `rc_amount_minor`, `deductibles` par niveau `BASICA` / `ESTANDAR` / `TOTAL`, `exclusions` en es / en / fr / pt-BR), toutes présentes ou toutes absentes (un contrat sans conditions ne promet rien). Aucune commande ne les écrit : comme le contrat lui-même, elles entrent par décision écrite du fondateur (US-227). Une fois posées, elles sont **immuables** (`INSURER_CONTRACT_TERMS_IMMUTABLE`) : un changement est une nouvelle version du contrat, et le contrat de location d'un trip (US-211) pourra citer la version.
2. **Garde** (revue sécurité de la PR #184) : minimum et devise contrôlés **à l'insertion ou quand une condition est posée** ; un `UPDATE` qui ne change aucune condition (clôture par `valid_to`) ne rejoue rien, pour qu'une version close sous un minimum relevé depuis laisse place à la suivante ; une version qui porte des conditions n'est jamais supprimée (`DELETE` refusé).
3. **RC au minimum du pays** : nouveau paramètre `insurer_rc_minimum` (graine générée `0114`, MONEY lié à la devise, BLOCK). La garde de la table refuse un contrat dont la RC est sous le minimum, dont le minimum est absent ou dont la devise n'est pas celle du pays (`POLICY_RC_BELOW_MINIMUM`, `INSURER_CONTRACT_CURRENCY_MISMATCH`) : rien n'est écrit. La lecture publique **revérifie** le minimum : un minimum relevé après coup retire la promesse.
4. **Lecture publique `core.catalog_public_terms(annonce, départ)`** (SECURITY DEFINER, propriétaire `catalog_cmd_owner`, EXECUTE au seul `app_api`) d'une annonce LISTED :
   - **annulation** : `free_cancel_lead` et `last_minute_threshold` du pays ; pour un départ donné, `freeUntil` de 08 BR-CXL-01 calculé à `platform.now()` comme si la réservation avait lieu maintenant : `lastMinute = (départ − maintenant) < seuil` (comparaison stricte, 25 h) ; hors dernière minute, `départ − 24 h` ; en dernière minute, aucune date (« gratuite pendant 1 h après la réservation ») ;
   - **distance** : mode, km par jour et prix du km de l'annonce ;
   - **caution** : même règle que les cartes (ADR-131) ;
   - **protection** : rendue seulement si l'interrupteur `insurer_contract_active[pays]` est vrai, qu'un contrat en vigueur d'un assureur ACTIVE couvre le véhicule (âge, classe, usage : 0081), que ses conditions sont posées dans la devise de l'annonce, que la RC atteint le minimum et que le courtier éventuel est ACTIVE ; sinon `protection_offered` = false et **aucune** donnée de l'assureur (19 US-205 critère 4). Aucune donnée personnelle ni de l'hôte.
5. **API** (CAT, module de la recherche) : `GET /listings/{id}/conditions` (public, `no-store`, sans limite de débit : aucune donnée de l'occupation) rend la politique du pays, la caution et la protection ; `GET /listings/{id}/availability` gagne, pour le créneau accepté, `cancellation` (date limite ou dernière minute, fenêtre de 60 min de 08) et `mileage` (km par jour × jours facturables du **même devis provisoire** que le total, 19 US-205 critère 2 : 200 × 3 = 600). Toute ligne inattendue ⇒ 503 (jamais une promesse devinée).
6. **Site (S03)** : sections « Cancelación », « Distancia incluida », « Protección » et « Depósito de garantía » sous le prix (`listing-terms.tsx`), textes es / en / fr / pt-BR (catalogue v58). Date limite à l'heure du lieu. Protection : assureur et courtier cités, RC tiers incluse à tout niveau, Básica obligatoire et déjà dans le prix final, franchise par niveau, exclusions du contrat dans la langue du visiteur, agrément. **Aucune protection promise ⇒ ni « Reservar » ni « protection de base incluse »** (bandeau `common.quote.insurerContractInactive`), même si le créneau est libre ; conditions illisibles ⇒ un seul message. Les conditions sont placées avant le prix et le bouton (le voyageur les lit avant de réserver) ; la retenue hors fenêtre n'écrit aucune durée (lien vers la politique publiée ; montant au checkout, 205b).

## Défauts PROPOSÉS (comme Turo, `docs/team/COMME_TURO.md`)

- Date limite d'annulation montrée **avant** de réserver, calculée pour une réservation faite maintenant ; règle unique de la plateforme par pays, jamais propre à l'hôte (UXQ-07).
- Distance affichée sur la période en km (jamais en miles).
- Protection : bloc sur la fiche, texte de l'assureur recopié du contrat ; RC tiers incluse à tout niveau, Básica comprise (OQ-P2P-12) ; RC **primaire** au minimum du pays (recommandation LATAM de 08 BR-PROT-04), valeur de test PA 100 000,00 USD, PY 750 000 000 PYG (À DÉCIDER, OQ-BR-16).
- Code PROPOSÉ : `POLICY_RC_BELOW_MINIMUM` (19 ; 16 PRT-003 le nomme `INSURER_RC_BELOW_MINIMUM`, nom proposé), `INSURER_CONTRACT_TERMS_IMMUTABLE`, `INSURER_CONTRACT_CURRENCY_MISMATCH`.

## Conséquences

- Le contrat de location (US-211) lira les mêmes colonnes et la même version : fiche et contrat ne peuvent pas diverger.
- Le refus du checkout quand l'interrupteur est fermé reste celui d'ADR-136 (`INSURER_CONTRACT_INACTIVE` au gel et à la pose, en base). Les autres cas où la fiche ne promet rien (contrat absent ou sans conditions, véhicule hors contrat, RC sous le minimum, courtier inactif) retirent le bouton sur la fiche ; leur refus **en base** au gel et à l'autorisation est une suite (L2-PM-08, US-223) : `booking_cmd_checkout` est remplacée en parallèle par US-209, elle n'est pas touchée ici.
- Découpage : cette PR (205a) livre la fiche. **205b** : distance et prix du km figés dans le devis (`quote.included_km`, `quote.extra_km_price_minor`, 16 LST-012) et affichés sur S05, date limite d'annulation sur S05 et au contrat, après la fusion d'US-226b et d'US-209 (S05 et la commande de checkout sont modifiés par ces deux stories).

## Report dans `docs/specs/` (PR revue)

ADR-138 en 17 §8.1 ; colonnes de `insurer_contract` en 17 §3.2.13 ; `insurer_rc_minimum` en 17 §7.2 ; codes en 16 A.8 ; clés `web.listing.cancel.*`, `web.listing.distance.*`, `web.listing.protection.*` en 10b §4.3.
