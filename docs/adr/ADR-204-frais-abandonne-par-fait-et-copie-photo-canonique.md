# ADR-204 — Un frais annexe abandonné vaut pour son fait (groupe et pièces), et la copie d'une photo est canonique

- **Statut** : PROPOSÉ (US-706 suite, preuves 2 ; agent de story, rôle back-end, claude-opus-5-5, 2026-11-23). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-202 (frais annexes, 0182 : abandon d'une demande contestée **par type**) et ADR-196 (empreinte unique de la copie nettoyée). **Modifie** ADR-099 sur un point : le profil ICC et l'en-tête JFIF ne sont plus conservés dans la copie d'une photo (annonce ou état du véhicule).
- **Sources** : passe de la porte de la red team du lot 3 (US-313, `docs/team/redteam/L3-porte.md`, PR de la red team non fusionnée au moment de cet ADR) : **F-L3-FRA-03** (élevé, `rt-l3-11-variantes` › RT-L3-S02) et **F-L3-PRE-04** (élevé, `l3-photo-variantes` › RT-L3-P03) ; 08 BR-REIMB-01, BR-REIMB-02 (la fenêtre du voyageur « ne peut pas être rouverte »), BR-REIMB-03, BR-REIMB-05 (doublons), SM-5 ; 16 TRP-004 (« une photo ne sert qu'une fois ») ; pré-mortem L3-PM-03, L3-PM-26.

## Contexte

1. **F-L3-FRA-03** : le correctif de 0182 bloque la redemande du **même type** après une contestation. Un nettoyage contesté puis annulé par l'hôte était redemandé sous le type « tabac », avec la même pièce : la demande était acceptée, avec une fenêtre de réponse neuve de 72 h et sans décision de l'ops. Le même fait changeait de type et rouvrait le délai. Un rejet de l'ops se contournait de la même façon.
2. **F-L3-PRE-04** : l'empreinte d'une photo d'état est la SHA-256 de la copie nettoyée (ADR-196). Cette copie gardait des champs libres : densité et vignette JFIF, charge d'un profil ICC, octets de bourrage `0xFF` du flux. Avec les mêmes pixels, une retouche d'un de ces champs donnait une autre empreinte, et l'index unique `trip_inspection_photo_sha256_unique` acceptait toutes les variantes.

## Décision

### A. Frais abandonné et pièce unique (migration 0184, F-L3-FRA-03 ; revue argent de la PR 302)

1. Un frais est **abandonné** quand sa demande est `REJECTED` (décision de l'ops) ou `CANCELLED_BY_HOST` **après** une contestation (`disputed_at` posé, ADR-202).
2. **Groupe « intérieur »** : nettoyage et tabac décrivent le même état de l'habitacle, avec le même plafond et les mêmes photos (08 BR-REIMB-01). **Arbitrage** : une contestation tranchée ou abandonnée sur l'un vaut pour l'autre. Sur le même trip, une demande d'un type du groupe d'un frais abandonné est refusée avec `INCIDENTAL_DUPLICATE`. Le carburant forme seul son groupe. **Voie support** : un hôte qui a de nouveaux éléments (une autre salissure, une odeur de tabac découverte après l'annulation) ne redemande pas ; il écrit au support, et l'ops juge le dossier (BR-REIMB-03). Aucune fenêtre du voyageur ne se rouvre.
3. **Une pièce ne soutient qu'une demande du trip** (revue argent : nettoyage et tabac vivants sur la même photo = le même fait facturé deux fois ; 08 BR-REIMB-05). Une nouvelle demande, de tout type, qui reprend une pièce d'une demande vivante, rejetée ou abandonnée du même trip est refusée avec `INCIDENTAL_DUPLICATE`. Seule une demande annulée **avant** toute contestation libère ses pièces.
4. **Inchangé** (ADR-202) : une demande annulée avant toute contestation libère aussi son type. Nettoyage et tabac vivants coexistent, chacun avec sa fenêtre et **ses propres pièces**. Le rejeu rend toujours la même demande. Rien n'est écrit quand la demande est refusée : aucune fenêtre, aucun avis. `common.incidental.duplicate` (catalogue v117, es / en / fr / pt-BR) dit les trois cas : type déjà demandé, groupe abandonné, pièce déjà utilisée.
5. **Concurrence** : la règle porte sur plusieurs lignes (le groupe et les pièces), ce n'est donc pas un index. Elle tient par le **verrou du trip**, que prend d'abord toute commande qui écrit une demande : demande, annulation, contestation, décision, débit (0177, 0182). Deux demandes du même trip, ou une demande et l'annulation ou le rejet d'une autre, se sérialisent ; la seconde relit l'état validé par la première. La preuve à deux connexions est `l0-us706-incidental-abandoned-race`. L'index unique de 0182 garde le cas du même type.
6. **Site** : le formulaire de l'hôte retire tout le groupe d'un frais abandonné et le dit (`web.incidental.form.abandonedTypes`). Une pièce reprise est refusée par l'API avec le message du doublon.
7. **Pourquoi un refus plutôt qu'une escalade à l'ops** : une redemande du même fait n'a rien de neuf à trancher ; les éléments nouveaux passent par le support (point 2). Une file d'escalade ajouterait un état et un délai, ce qui serait plus lourd que Turo.

### B. Copie canonique des photos (code, F-L3-PRE-04 ; revues de la PR 302)

1. `preparePhoto` (AUD, partagé par les photos d'annonce et d'état) rend une **copie canonique**, **réécrite** à partir de ce qu'un décodeur retient du fichier (libjpeg, celui des navigateurs), jamais recopiée segment par segment. L'empreinte reste **la SHA-256 de la copie stockée** (ADR-196 : une seule empreinte, celle des octets scellés). La comparaison avec les photos d'annonce reste cohérente, puisque les deux passent par la même fonction.
2. **JPEG** :
   - **espace de couleur** : celui que retient libjpeg (`default_decompress_parms`). À trois composantes : JFIF ⇒ YCbCr ; sinon le **dernier** APP14 « Adobe » avant le premier scan (transformée 0 ⇒ RGB, autre ⇒ YCbCr) ; sinon les identifiants (« R G B » ⇒ RGB, autres ⇒ YCbCr). Réécrit en un **JFIF canonique** (1.01, sans unité, 1:1, sans vignette) pour YCbCr, ou en un **Adobe canonique** (transformée seule) pour RGB. À quatre composantes : sans Adobe, CMYK, sans segment ; avec Adobe, la transformée 0 (CMYK, que les navigateurs inversent quand Adobe est présent) ou YCCK (toute autre valeur, comme libjpeg), réécrite en Adobe canonique 0 ou 2. Une ou deux composantes : aucun segment. Les identifiants des composantes sont renumérotés 1..n ;
   - **orientation** : la balise EXIF Orientation du **premier** APP1 EXIF avant le premier scan (comme les navigateurs) est la seule donnée EXIF gardée ; de 2 à 8, elle est réécrite dans un APP1 EXIF canonique (TIFF gros-boutiste, une entrée, rien d'autre) ; 1, absente ou illisible : aucun EXIF. Une photo portrait reste affichée debout ; la même image sous deux orientations reste deux images différentes ;
   - **tables** : la dernière définition d'un emplacement l'emporte (clé de quantification = les quatre bits de poids faible). Une table de quantification 16 bits dont toutes les valeurs tiennent sur 8 bits est ramenée à 8 bits. Une table de quantification est **figée au premier scan** de chaque composante, comme libjpeg ; ses emplacements canoniques sont attribués par contenu. Les tables de Huffman ont des emplacements **stables** sur toute l'image : une table déjà émise garde son emplacement, une table manquante prend le premier emplacement dont le contenu n'est pas lu par le scan. Seules les tables **lues** sont émises, juste avant le scan qui les lit, et seulement si elles manquent. Les tables inutilisées, répétées ou déplacées (DQT après la trame, DHT après le scan) disparaissent. Une table lue mais jamais définie reste absente (libjpeg échoue pour la quantification, prend sa table standard pour Huffman : même comportement des deux côtés) ;
   - **trame** : une trame séquentielle étendue (SOF1) compatible avec la trame de base (8 bits, tables de quantification 8 bits, au plus deux tables de Huffman par classe) est réécrite en trame de base (SOF0) ;
   - **DRI** : émis avant un scan seulement quand il change ; 0 vaut absent ;
   - **scans** : sélecteurs de tables non lus remis à 0 (Ta d'un scan DC progressif, Td d'un scan AC) ; scan séquentiel normalisé (Ss 0, Se 63, Ah / Al 0) ; flux sans bourrage `0xFF` ;
   - **retirés** : tous les APPn (EXIF, GPS, XMP, ICC, MPF, IPTC, vignette), COM, DNL, DAC, DHP, EXP, JPGn, marqueurs réservés, TEM et RSTn hors d'un flux, et tout ce qui suit le premier EOI ;
   - **refusés** (`MALFORMED`) : trames sans perte, hiérarchiques ou arithmétiques (aucun appareil photo ne les produit), plusieurs trames, scan avant la trame, composante jamais lue, plus de 128 scans. Une taille démesurée est refusée **dès la lecture de la trame**, avant toute autre analyse (`DIMENSIONS`, F2-U-01, L1-PM-42) ;
   - **JPEG sans DQT** (PROPOSÉ) : accepté ; la table de quantification absente reste absente dans la copie (libjpeg échoue des deux côtés, l'empreinte n'en dépend pas). Le refuser obligerait à réécrire les gabarits des red teams L1 et L3 sans gain ;
   - **borne de taille** : la copie n'est jamais plus grande que le fichier reçu plus 1 024 octets (segments JFIF, Adobe et EXIF réécrits) ; au-delà, refus `MALFORMED`. La copie est donc bornée à l'entrée + 1 024 octets, quel que soit le fichier (huit tables de 256 symboles et des scans qui permutent les sélecteurs compris).
3. **WebP** : une image fixe réécrite. Elle garde une trame VP8 ou VP8L et, pour un VP8 transparent, son ALPH (bits réservés à zéro) derrière un VP8X canonique (drapeau alpha seul, taille du canevas). Sans ALPH, le VP8X est retiré. ICCP, EXIF, XMP et les fragments inconnus sont retirés, les octets de bourrage remis à zéro. Le **WebP animé** (ANIM, ANMF, drapeau d'animation) est refusé, comme plusieurs trames ou un ALPH sans VP8X.
4. **PNG** est inchangé. Il n'est pas accepté pour les photos d'état (`INSPECTION_MIME_TYPES` : JPEG et WebP).
5. **Pourquoi pas les pixels décodés** : la pile n'a aucune bibliothèque d'image (`sharp` n'est pas une dépendance, ADR-099), et en ajouter une pour ce seul calcul n'est pas nécessaire. Une empreinte sur les pixels ne fermerait d'ailleurs que le ré-encodage sans perte (voir la classe ouverte).
6. **Effet visible, comme Turo** : sans profil ICC, une photo est rendue en sRGB. Les couleurs d'une photo « Display P3 » sont un peu moins saturées, sur l'annonce comme dans le dossier. Turo et la plupart des plateformes normalisent aussi leurs images. Rien n'est repris de Turo. Ce choix est PROPOSÉ et inscrit dans `COMME_TURO.md`.

## Classe fermée, classe ouverte (B)

- **Fermée** : toute variante qui garde **ce que le décodeur retient** et ne change que la forme du fichier. Cela couvre la trame étendue compatible contre la trame de base, une table de quantification 16 bits à valeurs sur 8 bits contre la même en 8 bits, tout l'EXIF sauf l'orientation, tous les APPn (JFIF, densité et vignette, EXIF, XMP, ICC avec n'importe quelle charge ou plusieurs profils, MPF, IPTC), les versions et drapeaux d'Adobe et l'ordre des Adobe, COM, DNL, DAC, JPGn, les marqueurs réservés, le bourrage `0xFF` (entre segments, dans le flux, avant EOI), le découpage, l'ordre, la position (avant ou après la trame, après le scan), la répétition et la redéfinition des tables, les tables inutilisées, la renumérotation des emplacements de tables et des identifiants de composantes, un DRI nul ou après le dernier scan, les champs Ss / Se / Ah / Al d'un scan séquentiel et les sélecteurs non lus. Côté WebP : ICCP, EXIF, XMP, les drapeaux et octets réservés de VP8X, un VP8X sans transparence, l'ordre de l'ALPH et ses bits réservés, l'octet de bourrage. L'ICC n'est **pas** gardé : deux profils différents donnent la même empreinte, ce qu'exige la red team.
- **Fermée par refus** : JPEG sans perte, hiérarchique ou arithmétique, WebP animé.
- **Ouverte** (assumée, ADR-196), exactement :
  - tout **ré-encodage**, avec ou sans perte (autre qualité, autres tables, autre découpage en scans, recadrage d'un pixel) ;
  - des **octets ajoutés en fin de flux** d'un scan (ignorés par le décodeur une fois l'image complète), y compris des bits de remplissage différents ;
  - des **RSTn en trop** dans le flux ;
  - un **octet en fin de trame** VP8 ou VP8L (après les partitions) ;
  - le cas de bord d'une table de Huffman absente, que libjpeg remplace par la table standard, contre la même table écrite explicitement.
  - une trame SOF1 qui lit plus de deux tables de Huffman par classe (gardée en SOF1, contre la même image écrite autrement) ;
  - un symbole de Huffman jamais émis par le flux (une table plus longue que nécessaire) ;
  - un DRI supérieur au nombre de MCU de l'image (aucune reprise atteinte, contre l'absence de DRI) ;
    Une empreinte sur les pixels décodés demanderait un décodeur et ne fermerait que le ré-encodage **sans perte**. Le ré-encodage **avec perte** demanderait une empreinte **perceptuelle** (distance et seuil à régler, faux positifs à trancher par l'ops), plus lourde que Turo. C'est une suite du BOARD (lot C, stockage réel).
- **Ce que la classe ouverte permet, et sa borne** : l'unicité d'une pièce (A.3) et l'anti-doublon des photos d'état reposent sur l'empreinte. Une variante de la classe ouverte peut donc faire passer la même prise de vue pour une pièce neuve, par exemple pour soutenir à la fois un nettoyage et un tabac. Ce débit reste borné : chaque demande a son plafond du pays, le voyageur voit les photos avant de payer et peut contester (CLM-021, BR-REIMB-03), et l'ops tranche la contestation. Le même fait coûte donc au plus **deux fois le plafond** (nettoyage et tabac), et seulement si le voyageur ne conteste pas. Le contrôle humain reste l'heure serveur de chaque prise, le gabarit et la revue de l'ops (16 TRP-004).

## Limite assumée

Voir la classe ouverte ci-dessus : ré-encodage et flux compressé. C'est la limite d'ADR-196.

## Existant et migration

- **A** : la bêta n'est servie nulle part et il n'y a aucun frais annexe en production. La règle ne juge que les nouvelles demandes : rien n'est réécrit et aucun index n'est créé.
- **B** : les empreintes déjà stockées sont celles de l'ancienne copie nettoyée. Aucune n'existe en production, car l'antivirus n'a aucun adaptateur réel (Q-019) : tout envoi y rend `PHOTO_UPLOAD_UNAVAILABLE`, et aucune photo n'est déposée. Les preuves en base posent des octets aléatoires. Aucune reprise n'est donc nécessaire. Si des photos avaient été stockées avant la mise en service, il faudrait recalculer leur empreinte depuis la copie scellée (déchiffrer, `preparePhoto`, SHA-256) dans une migration de données revue. Sinon, une ancienne photo renvoyée ne serait pas reconnue. La copie canonique est idempotente : une seconde passe ne change rien.

## Conséquences

- Preuves :
  - **A** : `l0-us706-incidental-abandoned` (2079 ; PA / USD et PY / PYG ; rôles de production) : tabac après un nettoyage abandonné, avec la même pièce ou une autre ; carburant qui reprend la pièce ; nettoyage rejeté ; carburant abandonné puis nettoyage avec une jauge reprise (refusé) ou avec ses propres pièces (accepté) ; témoins. `l0-us706-incidental-abandoned-race` (2080) : annulation et rejet contre un tabac, à deux sessions. Deux attendus de `l0-us706-incidental-contest` et `l0-us706-incidental-fees` sont mis à jour : le tabac redemandé sur le trip d'un nettoyage abandonné est désormais refusé, et le témoin « annulée avant contestation » est joué sur un trip sans abandon ;
  - **B** : `aud/internal/photo-canonical.test.ts` (variantes JPEG et WebP, témoins de pixels, idempotence, tables mal formées) ; attendus de `photo-ingest` (JFIF, ICC et ICCP retirés) et du contrat `trip-inspection` (le gabarit sans JFIF : copie = envoi) mis à jour ;
  - red team : les `it.fails` F-L3-FRA-03 (`rt-l3-11-variantes`) et F-L3-PRE-04 (`l3-photo-variantes`) sont inversés en tests de comportement depuis la fusion de la red team de la porte. `l3-photo-variantes` porte en plus les attaques des revues : tables (DQT après la trame, DQT répétée, DRI 0) et amplification (huit tables de 256 symboles, scans qui permutent les sélecteurs ; au-delà de 128 scans, refus).
- Migration 0184 : une fonction remplacée (`core.claim_cmd_submit_incidental`), avec la même signature, le même propriétaire et les mêmes droits. Aucun droit, aucune table, aucun paramètre ni interrupteur.

## Alternatives écartées

- **Escalade à l'ops** de toute redemande après un abandon : un état et une file de plus, pour une affaire déjà jugée ou abandonnée (point A.7).
- **Pièce seule** (sans le groupe) : l'hôte prendrait une autre photo du même habitacle, et le fait se redemanderait.
- **Empreinte séparée** (une colonne de plus, sur les pixels ou sur la copie canonique, à côté des octets stockés) : deux empreintes pour un même fichier, une migration et un index de plus, et la comparaison avec les photos d'annonce à refaire. La copie canonique stockée garde une seule empreinte.
- **Décodage des pixels** par une bibliothèque nouvelle (`sharp`, `jpeg-js`) : une dépendance native ou un décodeur partiel pour ce seul calcul ; c'est la suite perceptuelle d'ADR-196.

## Retour arrière

- A : une nouvelle migration rétablit le corps de `core.claim_cmd_submit_incidental` de 0182.
- B : rétablir la recopie par liste blanche d'ADR-099 dans `photo-checks.ts` (JFIF, ICC et ICCP conservés). Les empreintes déjà calculées sur la copie canonique resteraient des empreintes valides de leurs octets.
