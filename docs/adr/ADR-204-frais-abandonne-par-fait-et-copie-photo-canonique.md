# ADR-204 — Un frais annexe abandonné vaut pour son fait (groupe et pièces), et la copie d'une photo est canonique

- **Statut** : PROPOSÉ (US-706 suite, preuves 2 ; agent de story, rôle back-end, claude-opus-5-5, 2026-11-23). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-202 (frais annexes, 0182 : abandon d'une demande contestée **par type**) et ADR-196 (empreinte unique de la copie nettoyée). **Modifie** ADR-099 sur un point : le profil ICC et l'en-tête JFIF ne sont plus conservés dans la copie d'une photo (annonce ou état du véhicule).
- **Sources** : passe de la porte de la red team du lot 3 (US-313, `docs/team/redteam/L3-porte.md`, PR de la red team non fusionnée au moment de cet ADR) : **F-L3-FRA-03** (élevé, `rt-l3-11-variantes` › RT-L3-S02) et **F-L3-PRE-04** (élevé, `l3-photo-variantes` › RT-L3-P03) ; 08 BR-REIMB-01, BR-REIMB-02 (la fenêtre du voyageur « ne peut pas être rouverte »), BR-REIMB-03, BR-REIMB-05 (doublons), SM-5 ; 16 TRP-004 (« une photo ne sert qu'une fois ») ; pré-mortem L3-PM-03, L3-PM-26.

## Contexte

1. **F-L3-FRA-03** : le correctif de 0182 bloque la redemande du **même type** après une contestation. Un nettoyage contesté puis annulé par l'hôte était redemandé sous le type « tabac », avec la même pièce : la demande était acceptée, avec une fenêtre de réponse neuve de 72 h et sans décision de l'ops. Le même fait changeait de type et rouvrait le délai. Un rejet de l'ops se contournait de la même façon.
2. **F-L3-PRE-04** : l'empreinte d'une photo d'état est la SHA-256 de la copie nettoyée (ADR-196). Cette copie gardait des champs libres : densité et vignette JFIF, charge d'un profil ICC, octets de bourrage `0xFF` du flux. Avec les mêmes pixels, une retouche d'un de ces champs donnait une autre empreinte, et l'index unique `trip_inspection_photo_sha256_unique` acceptait toutes les variantes.

## Décision

### A. Frais abandonné (migration 0184, F-L3-FRA-03)

1. Un frais est **abandonné** quand sa demande est `REJECTED` (décision de l'ops) ou `CANCELLED_BY_HOST` **après** une contestation (`disputed_at` posé, ADR-202).
2. Le **fait** d'un frais abandonné couvre :
   - **son groupe de types**. Nettoyage et tabac forment le groupe « intérieur » : c'est le même état de l'habitacle, avec le même plafond et les mêmes photos (08 BR-REIMB-01). Le carburant forme seul son groupe ;
   - **chacune de ses pièces**, quel que soit le type de la nouvelle demande.
3. Sur le même trip, une nouvelle demande est refusée avec `INCIDENTAL_DUPLICATE` si son type appartient au groupe d'un frais abandonné, ou si elle reprend une de ses pièces. C'est un signal existant, sans texte nouveau, et `common.incidental.duplicate` couvre déjà « abandonnée ». Rien n'est écrit : aucune fenêtre du voyageur, aucun avis.
4. **Inchangé** (ADR-202) : une demande annulée **avant** toute contestation libère son type et ses pièces. Deux demandes vivantes du groupe « intérieur » coexistent, chacune avec sa fenêtre, car 08 les liste à part. Le rejeu rend toujours la même demande.
5. **Concurrence** : la règle porte sur plusieurs lignes (le groupe et les pièces), ce n'est donc pas un index. Elle tient par le **verrou du trip**, que prend d'abord toute commande qui écrit une demande : demande, annulation, contestation, décision, débit (0177, 0182). Une redemande et l'annulation ou le rejet d'une demande du même trip se sérialisent, et la seconde relit l'état validé par la première. La preuve à deux connexions est `l0-us706-incidental-abandoned-race`. L'index unique de 0182 garde le cas du même type.
6. **Site** : le formulaire de l'hôte retire tout le groupe d'un frais abandonné et le dit (`web.incidental.form.abandonedTypes`, texte inchangé : « Plus proposé : Nettoyage, Tabac »). Une pièce reprise est refusée par l'API avec le message du doublon.
7. **Pourquoi un refus plutôt qu'une escalade à l'ops** : c'est la forme la plus simple qui ferme la fenêtre. Une redemande du même fait n'a rien de neuf à trancher : la contestation a déjà eu lieu, et l'hôte l'a abandonnée ou l'ops l'a rejetée. Une file d'escalade ajouterait un état et un délai, ce qui serait plus lourd que Turo.

### B. Copie canonique des photos (code, F-L3-PRE-04)

1. `preparePhoto` (AUD, partagé par les photos d'annonce et d'état) rend une **copie canonique**. Elle ne dépend que des données de l'image : aucun champ libre n'en change les octets, donc l'empreinte non plus. L'empreinte reste **la SHA-256 de la copie stockée** (ADR-196 : une seule empreinte, celle des octets scellés, de `file_asset.sha256` et de `trip_ops_inspection_photo.sha256`). La comparaison avec les photos d'annonce reste donc cohérente, puisque les deux passent par la même fonction.
2. **JPEG** :
   - seuls restent les segments qui portent l'image : trames (SOFn), scans (SOS et flux), tables (DQT, DHT, DAC), DRI, DNL, DHP, EXP ;
   - **retirés** : APP0 (JFIF : densité et vignette ; facultatif pour un décodeur), APP2 (profil ICC, MPF), tous les autres APPn, COM, JPGn, les marqueurs réservés, TEM et RSTn hors d'un flux ;
   - **réécrit** : APP14 « Adobe » garde seulement sa transformée de couleur, qui décide du rendu des pixels. Il est émis une fois, avant la première trame ;
   - **tables** : DQT, DHT et DRI sont relues table par table (la dernière définition l'emporte, comme pour un décodeur), puis réécrites une table par segment, dans un ordre fixe, avant chaque trame ou scan. Découper, fusionner, réordonner ou redéfinir à l'identique ne change rien. Une table mal formée donne `MALFORMED` ;
   - **flux** : une suite d'octets `0xFF` se réduit à un seul devant `0x00` (octet bourré) ou un RSTn, et disparaît devant le marqueur qui termine le scan. Il n'y a jamais de bourrage, entre deux segments comme avant EOI.
3. **WebP** :
   - ICCP est retiré ;
   - les drapeaux de VP8X sont réduits à alpha (`0x10`) et animation (`0x02`) ; ICC, EXIF, XMP et les bits réservés sont remis à zéro, comme les trois octets réservés ;
   - l'octet de bourrage d'un fragment impair est remis à zéro.
4. **PNG** est inchangé. Il n'est pas accepté pour les photos d'état (`INSPECTION_MIME_TYPES` : JPEG et WebP). Ses fragments de rendu restent tels qu'ADR-099 les liste.
5. **Pourquoi pas les pixels décodés** : la pile n'a aucune bibliothèque d'image (`sharp` n'est pas une dépendance, ADR-099), et en ajouter une pour ce seul calcul n'est pas nécessaire. Ré-encoder demanderait aussi un décodeur. La copie canonique ferme les variantes qui ne touchent aucune donnée d'image, sans dépendance nouvelle.
6. **Effet visible, comme Turo** : sans profil ICC, une photo est rendue en sRGB. Les couleurs d'une photo « Display P3 » sont un peu moins saturées, sur l'annonce comme dans le dossier. Turo et la plupart des plateformes normalisent aussi leurs images. Rien n'est repris de Turo. Ce choix est PROPOSÉ et inscrit dans `COMME_TURO.md`.

## Classe fermée, classe ouverte (B)

- **Fermée** : toute variante qui garde **à l'identique les données d'image** (trame, tables, flux compressé) et ne change que des champs libres. Cela couvre tous les APPn (JFIF, densité et vignette, EXIF, XMP, ICC avec n'importe quelle charge ou plusieurs profils, MPF, IPTC), COM, JPGn, les marqueurs réservés, le bourrage `0xFF` (entre segments, dans le flux, avant EOI), la version et les drapeaux d'Adobe, le découpage, l'ordre et la redéfinition à l'identique des tables, et, pour le WebP, ICCP, les drapeaux et octets réservés de VP8X et l'octet de bourrage. L'ICC n'est **pas** gardé : deux profils différents donnent la même empreinte, ce qu'exige l'`it.fails` de F-L3-PRE-04.
- **Ouverte** (assumée, ADR-196) : toute variante qui **ré-encode** l'image (avec ou sans perte : autre qualité, autres tables, JPEG progressif contre séquentiel, recadrage d'un pixel) ou change un bit du flux compressé. Les pixels ne sont pas décodés : la pile n'a aucun décodeur, et en ajouter un (`sharp` est natif et lourd) pour ce seul calcul n'est pas nécessaire. Une empreinte sur les pixels décodés ne fermerait d'ailleurs que le ré-encodage **sans perte**. Le ré-encodage avec perte demanderait une empreinte **perceptuelle** (distance de Hamming et seuil à régler, faux positifs à trancher par l'ops), ce qui serait plus lourd que Turo. Ce cas reste une suite du BOARD (lot C, stockage réel). Le contrôle qui le couvre aujourd'hui est humain : l'heure serveur de chaque prise, le gabarit et la revue de l'ops (16 TRP-004).

## Limite assumée

La règle B ne reconnaît ni une image **ré-encodée**, ni une image dont un **bit de remplissage** du flux compressé (la fin du dernier octet d'un segment entropique) ou une donnée d'image a changé. C'est la limite d'ADR-196 : une empreinte perceptuelle reste une suite du BOARD, à faire avec le stockage réel du lot C. Pour le WebP, la présence ou l'absence d'un VP8X, les champs d'ANIM et des octets ignorés au bout d'une trame VP8 sont dans le même cas.

## Existant et migration

- **A** : la bêta n'est servie nulle part et il n'y a aucun frais annexe en production. La règle ne juge que les nouvelles demandes : rien n'est réécrit et aucun index n'est créé.
- **B** : les empreintes déjà stockées sont celles de l'ancienne copie nettoyée. Aucune n'existe en production, car l'antivirus n'a aucun adaptateur réel (Q-019) : tout envoi y rend `PHOTO_UPLOAD_UNAVAILABLE`, et aucune photo n'est déposée. Les preuves en base posent des octets aléatoires. Aucune reprise n'est donc nécessaire. Si des photos avaient été stockées avant la mise en service, il faudrait recalculer leur empreinte depuis la copie scellée (déchiffrer, `preparePhoto`, SHA-256) dans une migration de données revue. Sinon, une ancienne photo renvoyée ne serait pas reconnue. La copie canonique est idempotente : une seconde passe ne change rien.

## Conséquences

- Preuves :
  - **A** : `l0-us706-incidental-abandoned` (2079 ; PA / USD et PY / PYG ; rôles de production) : tabac après un nettoyage abandonné, avec la même pièce ou une autre ; carburant qui reprend la pièce ; nettoyage rejeté ; carburant abandonné puis nettoyage avec une jauge reprise (refusé) ou avec ses propres pièces (accepté) ; témoins. `l0-us706-incidental-abandoned-race` (2080) : annulation et rejet contre un tabac, à deux sessions. Deux attendus de `l0-us706-incidental-contest` et `l0-us706-incidental-fees` sont mis à jour : le tabac redemandé sur le trip d'un nettoyage abandonné est désormais refusé, et le témoin « annulée avant contestation » est joué sur un trip sans abandon ;
  - **B** : `aud/internal/photo-canonical.test.ts` (variantes JPEG et WebP, témoins de pixels, idempotence, tables mal formées) ; attendus de `photo-ingest` (JFIF, ICC et ICCP retirés) et du contrat `trip-inspection` (le gabarit sans JFIF : copie = envoi) mis à jour ;
  - red team : à la fusion de sa PR, les `it.fails` F-L3-FRA-03 (`rt-l3-11-variantes`) et F-L3-PRE-04 (`l3-photo-variantes`) seront inversés en tests de comportement.
- Migration 0184 : une fonction remplacée (`core.claim_cmd_submit_incidental`), avec la même signature, le même propriétaire et les mêmes droits. Aucun droit, aucune table, aucun paramètre ni interrupteur.

## Alternatives écartées

- **Escalade à l'ops** de toute redemande après un abandon : un état et une file de plus, pour une affaire déjà jugée ou abandonnée (point A.7).
- **Pièce seule** (sans le groupe) : l'hôte prendrait une autre photo du même habitacle, et le fait se redemanderait.
- **Empreinte séparée** (une colonne de plus, sur les pixels ou sur la copie canonique, à côté des octets stockés) : deux empreintes pour un même fichier, une migration et un index de plus, et la comparaison avec les photos d'annonce à refaire. La copie canonique stockée garde une seule empreinte.
- **Décodage des pixels** par une bibliothèque nouvelle (`sharp`, `jpeg-js`) : une dépendance native ou un décodeur partiel pour ce seul calcul ; c'est la suite perceptuelle d'ADR-196.

## Retour arrière

- A : une nouvelle migration rétablit le corps de `core.claim_cmd_submit_incidental` de 0182.
- B : rétablir la liste blanche d'ADR-099 dans `photo-checks.ts` (JFIF, ICC et ICCP conservés). Les empreintes déjà calculées sur la copie canonique resteraient des empreintes valides de leurs octets.
