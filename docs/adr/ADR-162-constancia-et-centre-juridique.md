# ADR-162 — Constancia d'arrendamiento tirée du contrat figé, centre juridique et voie de litige

- **Statut** : PROPOSÉ (US-212, agent back-end, claude-opus-5-5, 2026-11-18), « comme Turo » (`docs/team/COMME_TURO.md`). Revues exigées : celles de `check-story-reviews.mjs` (revue design OUI pour US-212). Le `SECURITY DEFINER` et les rôles se revoient sur un autre modèle que l'auteur. Textes juridiques BROUILLON à faire valider par l'avocat (GL-39, `docs/team/POUR_LE_FONDATEUR.md` §4.1 octies). À reporter dans 16 A.8 (codes `CONSTANCIA_*`), 17 §3.2.6 (`generated_document` de genre `CONSTANCIA` : sans fichier) et 10b §4.3 (clés v78).
- **Complète** : ADR-143 (contrat figé, `ctr.pdf/1`), ADR-149 (partie d'un trip jugée en base, titulaire du compte d'hôte, PDF re-rendu sans stockage), ADR-160 (S09).
- **Sources** : 19 US-212 (critères 1 à 3) ; 16 LEG-026, LEG-011 / LEG-015, LEG-014 ; 08 BR-TT-03 ; 11 EC-48 ; 10b S07, S09, A05, UX-51 ; pré-mortem L2-PM-26, L2-PM-35, L2-PM-36.

## Contexte

LEG-026 décrit une constancia bilingue (plaque, période exacte, hôte, conducteur, lieu de remise, signature horodatée), téléchargeable par le voyageur et l'hôte, « stockée avec empreinte ». US-211 a déjà figé, à chaque version du contrat, tous ces faits (`terms` dans le registre immuable, `identity` dans la partie nominative pseudonymisable), et rend le PDF du contrat par un rendu déterministe sans fichier (ADR-143 n° 5, ADR-149). LEG-011 / LEG-015 / LEG-014 demandent des pages légales versionnées et la mention « intermédiaire entre particuliers, marchand de référence, pas une société de location ».

## Décision

1. **La constancia n'a aucun fait propre** : elle reprend les faits FIGÉS de la **dernière version** du contrat du trip, jamais recalculés (devis, fiche ou véhicule modifiés après la réservation ne la changent pas). Elle suit le contrat : une nouvelle version du contrat (BR-BOOK-12) donne une nouvelle constancia. Signature horodatée = acceptation du voyageur sur cette version, rendue à l'heure locale du trip **par la base**.
2. **Lecture par les parties seulement** (migration 0138, `cmd_hold_owner`, EXECUTE `app_api`, aucun droit nouveau) : `core.booking_trip_constancia(empreinte de session, trip)` rend les faits au voyageur du trip ou au **titulaire** du compte d'hôte ; toute autre personne, un trip inconnu ou un identifiant mal formé : `NOT_FOUND`, même réponse (404). Trip annulé : `NOT_AVAILABLE` ; aucun contrat : `NOT_GENERATED` ; partie nominative pseudonymisée : `ERASED` (409).
3. **Minimisation** (L2-PM-35) : hôte en **prénom et initiale** (le contrat, signé par les parties, porte son nom complet ; la constancia est montrée à des tiers) ; conducteur tel que nommé au contrat (prénom et initiale) ; lieu de remise réduit au nom du lieu et à la ville ; jamais de pièce, de contact, de permis ni d'adresse exacte. Le nom complet du conducteur sur la constancia est une question pour l'avocat (POUR_LE_FONDATEUR §4.1 octies).
4. **Aucun fichier stocké** : le PDF est rendu à chaque demande par l'API avec le rendu déterministe du contrat (`ctr.pdf/1`, mêmes faits ⇒ mêmes octets) ; son empreinte SHA-256 est calculée au rendu, servie dans `X-Constancia-Sha256` et dans la vue JSON (équivalent HTML, UX-51). L'empreinte n'est pas enregistrée : rien ne se signe sur la constancia, c'est le contrat qui fait foi (son empreinte l'est, ADR-143). `generated_document(kind=CONSTANCIA, pdf_file_id)` de 16 LEG-026 devient « sans fichier » : à reporter dans 17.
5. **Bilingue** : espagnol (fait foi) puis la langue du lecteur (`preferred_locale`) ; un lecteur hispanophone, ou sans langue connue, reçoit l'anglais (19 US-212 « es et en »). Le voyageur et l'hôte reçoivent donc la même partie espagnole et chacun sa traduction.
6. **Gabarit** : textes `ctr.constancia.*` du catalogue (version 1, catalogue v78), BROUILLON (`CONSTANCIA_TEMPLATE_DRAFT`) tant que l'avocat ne les a pas validés (GL-39) ; aucune « definitiva e inapelable » ; la plateforme y est « intermédiaire entre particuliers, ni loueur ni propriétaire du véhicule » et « marchand de référence » du paiement. US-606 chargera le texte validé.
7. **Recherche de l'hôte** (EC-48 ; 19 US-212 « recherche par plaque et date ») : `POST /trips/constancias/search` `{ plate, date }`, plaque dans le CORPS (jamais dans une URL ni un journal) ; `core.booking_host_constancia_search` ne rend que les trips du compte dont la session est titulaire, dont la plaque FIGÉE au dernier contrat (sans casse, espaces ni tirets) et la période locale couvrent la date, **jusqu'au lendemain de la fin** (08 BR-TT-03 : PV de stationnement imputables 24 h après la fin), au plus vingt.
8. **Centre juridique** (`/legal`, public) : positionnement d'intermédiaire entre particuliers (ni loueur ni propriétaire ; marchand de référence ; protection vendue pour l'assureur partenaire), documents publiés (CGU du voyageur et de l'hôte, confidentialité, annulation, zones), documents de chaque trip, **voie de litige comme Turo** : messagerie entre les parties, puis support avec le numéro du trip et médiation interne, voies externes (protection du consommateur, tribunaux) toujours ouvertes, loi du lieu du trip. Textes du catalogue (`web.legalCenter.*`), gabarit versionné (version 1, date) et BROUILLON (pas de bloc éditable, US-121).
9. **Points d'accroche** : S09 · contrat et A03 · contrat portent « Otros documentos del viaje » (constancia, recherche de l'hôte, centre juridique). S09 (détail du trip, US-214) et la confirmation (US-213) y renvoient quand ces stories auront fusionné.

## Conséquences

- Aucune table, aucun droit, aucun paramètre, aucun interrupteur : deux fonctions de lecture.
- La constancia d'un trip dont le contrat est pseudonymisé n'est plus servie (`ERASED`), comme le texte du contrat (ADR-149).
- Une modification d'un texte `ctr.constancia.*` change les octets des constancias rendues ensuite : acceptable, aucune constancia n'est stockée ni signée.

## Suites

- Mention d'intermédiaire et hôte en prénom et initiale au checkout S05 et sur le reçu (critère 3 d'US-212 : le contrat et la constancia l'ont ; S05 en recapture de huit écrans, le reçu avec US-217).
- Lien depuis S09 (US-214, #230), pièce jointe ou lien de la confirmation (US-213, GL-36), lien du centre juridique dans le pied de la coquille.
- Mise en cache hors ligne (UX-06), consultation par l'ops (`OPS_AGENT`, LEG-026), voies externes nommées par pays (configuration), contact du support (SUP-004).
