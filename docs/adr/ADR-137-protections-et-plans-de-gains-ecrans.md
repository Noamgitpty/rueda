# ADR-137 — Protections du voyageur et plans de gains : écrans S05, A10 et A11, un gel par choix validé

- **Statut** : PROPOSÉ (US-226, partie 226b, agent front-end, claude-opus-5-5, 2026-11-16). Revues exigées (`check-story-reviews.mjs`, story US-226) : architecture, argent, code, qa, sécurité, ux ; argent sur un autre modèle que l'auteur.
- **Sources** : 19 US-226 (critères 1 à 3 et 5) ; 16 PRT-001 / PRT-002 / BKG-003 / PRC-018, PRT-007 / PRT-008 / HST-048, PRT-011, PRT-015, SRC-042 ; 08 BR-PROT-06, BR-PROT-09 ; 10b v3 S05, A10, A11, UX-15, UX-17, UX-50, UX-55 ; ADR-133, ADR-134, ADR-136 ; revues de la PR #179 (`docs/team/reviews/US-226/`).

## Contexte

La partie 226a (ADR-136) livre le serveur : `POST /checkout/quotes` accepte `protectionLevel` et `driverAge`, le devis lu rend `protectionOptions` (niveaux vendus, prix par jour et pour la période, éligibilité à l'âge déclaré, raison `DRIVER_AGE`), `driverAge` et `insurerContractActive` ; les routes de l'hôte rendent et changent le plan de gains d'un véhicule. Chaque gel de devis compte dans `quote_freezes_per_guest_hour` (30 par heure, PROPOSÉ). Il reste les écrans, et les constats MINEUR des revues de 226a.

## Décision

1. **S05, section « Elige tu protección »** (`protection-form.tsx`), au-dessus du détail du prix et du bouton : âge déclaré (facultatif, 16 à 99 ans), niveaux par rang croissant avec « {prix par jour} por día · {prix de la période} en total » lus de `protectionOptions` (jamais calculés par le site), niveau du devis présélectionné (`BASICA` au premier devis), aucune option « sans protection ». Niveau refusé à l'âge déclaré : bouton radio `disabled`, cadre en tirets et raison liée (`aria-describedby`) « Disponible desde los {age} años » (16 PRT-001 « grisé avec sa raison »), plus « Indica tu edad para elegirla » sans âge.
2. **Un gel par choix validé** : changer de niveau ou d'âge ne fige rien ; « Actualizar el precio » envoie `POST /checkout/quotes` (même annonce, même période, niveau, âge) puis ouvre S05 du **nouveau** devis (`?protection=1`, bandeau « Protección actualizada ») avec son total. Même choix que le devis affiché ⇒ bouton inactif (`aria-disabled`, aide liée) et, sans JavaScript, retour au même devis sans gel. Avec JavaScript, l'âge saisi rend un niveau choisissable tout de suite (`minDriverAge`) : affichage seulement, la base juge au gel (`PROTECTION_LEVEL_NOT_ELIGIBLE`, lié au groupe des niveaux).
3. **Prix redemandé** (devis expiré, ADR-134) : le nouveau gel reprend le niveau et l'âge du devis expiré (un prix redemandé ne retire jamais un choix).
4. **Contrat de l'assureur fermé** (`insurerContractActive` = `false`, 16 PRT-001) : S05 sans formulaire, message `common.quote.insurerContractInactive` et bouton « Buscar otro auto » (revue ux de 226a, n° 5) ; au gel depuis S03, `INSURER_CONTRACT_INACTIVE` est annoncé sur la fiche. `PROTECTION_LEVEL_REQUIRED`, `PROTECTION_LEVEL_NOT_ELIGIBLE` et `INSURER_CONTRACT_INACTIVE` ont leur message (`CHECKOUT_KEYS`).
5. **Lecture défensive** (`account/checkout.ts`) : un niveau mal formé ou en double, deux niveaux sélectionnés, un niveau refusé sans raison (ou l'inverse), ou un niveau sélectionné dont le niveau ou la ligne diffère de la ligne `PROTECTION` du devis ⇒ devis jamais affiché (fail-closed). Une réponse antérieure à US-226 (sans ces champs) reste lisible, sans section.
6. **« Protección básica incluida »** (`common.price.protectionIncluded`) près du total de chaque carte de résultats et de la fiche S03 : le total de l'API comprend toujours la protection minimale du pays (N-141, 16 SRC-042 ; revue ux de 226a, n° 7).
7. **A11, plan de gains par véhicule** (`/host/vehicles/{id}/earnings-plan`, lien sur chaque auto d'A10 avec le plan en vigueur) : plan expliqué en une phrase (part du prix de chaque trip reçue par l'hôte), « Asignado por defecto » ou « Elegido por ti » ; un seul plan vendu ⇒ aucun sélecteur (« Por ahora es el único plan disponible ») ; plusieurs ⇒ boutons radio, effet rappelé avant « Guardar el plan », confirmation `common.listing.earningsPlanSaved` après l'enregistrement (16 PRT-007, « confirmation in-app ») ; `PRO` filtré même si une réponse le portait. Nom d'un plan : `ESTÁNDAR` ⇒ « Estándar / Standard / Standard / Padrão » ; un plan inconnu est nommé par sa part, jamais par son code. La part affichée est la fraction `host_share_pct` rendue par l'API, en pourcentage exact au dixième (sinon le plan est refusé).
8. **Couverture de l'hôte** (16 PRT-015, BR-PROT-09) : A11 dit que la voiture est couverte pendant la période de la réservation ; la franchise et les exclusions viennent du contrat de l'assureur et seront affichées mot pour mot avant toute activation d'hôte (aucun hôte n'est activable sans `insurer_contract_active`) : ligne **GL-18** de `docs/ops/GO_LIVE_CHECKLIST.md`, avec `protection_grid` et `insurer_premium_share` (revue architecture de 226a, n° 8).
9. **Noms des niveaux** en minuscules dans les quatre langues (« Protección básica », « Basic protection », « Protection de base », « Proteção básica » ; revue ux de 226a, n° 3), comme les exemples `web.catalog.sample.line.protection`.

## Conséquences

- Le voyageur voit le prix de chaque niveau avant de valider ; un changement coûte un gel, jamais plus ; les références visuelles de S05 sans protection (jours du double autres que le 25) ne changent pas.
- Le site ne calcule aucun montant : prix des niveaux, ligne et total viennent de l'API (L2-PM-03) ; le pourcentage du plan est un affichage de la fraction de configuration.
- Nouveaux écrans balayés (`SCREENS`) : `checkout-protection`, `checkout-protection-total`, `checkout-assureur-ferme`, `hote-plan-gains`, `hote-plan-gains-choix` ; parcours `e2e/checkout.spec.ts` et `e2e/host-earnings-plan.spec.ts` (360 et 390 px, quatre langues).

## Suites

- Franchise du voyageur par niveau sur S05 et franchise et exclusions de l'hôte sur A11 : données du contrat de l'assureur (grille à compléter, GL-18).
- Éligibilité par la valeur du véhicule (PRT-002) : la grille ne porte que l'âge.
- Recoupement de l'âge déclaré avec la date de naissance vérifiée : contrôles bloquants (US-209).
- Changement de protection après la réservation (16 TRP-029, P1).
