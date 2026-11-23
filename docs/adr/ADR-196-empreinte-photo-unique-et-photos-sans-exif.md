# ADR-196 — Photos d'état : empreinte unique tous trips (photos d'annonce comprises) et copie sans EXIF seule gardée

- **Statut** : PROPOSÉ (suite d'US-303, agent backend, claude-opus-5-5, 2026-11-22). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` ; RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-179 (photos guidées, US-303), ADR-099 (contrôles des photos d'annonce, `preparePhoto`), ADR-184 (dossier de preuve, US-308).
- **Complété par** : ADR-204 (2026-11-23) — la copie nettoyée est canonique : ses octets, donc l'empreinte, ne dépendent plus d'aucun champ libre (F-L3-PRE-04) ; la limite du ré-encodage reste.
- **Sources** : red team du lot 3 (`docs/team/redteam/L3-preuves-versements.md`) : F-L3-PRE-01 (élevé) et F-L3-PRE-02 (élevé) ; pré-mortem du lot 3, L3-PM-03 (« refus d'une empreinte SHA-256 déjà enregistrée, tous trips, photos d'annonce comprises ») et L3-PM-06 (« EXIF retiré de la copie servie ») ; 16 TRP-004 ; 19 US-303 critère 2 ; 17 §3.2.10, §3.2.13, §5.

## Contexte

1. **F-L3-PRE-01** : `core.trip_cmd_add_inspection_photo` (0158) acceptait le même fichier à plusieurs angles d'une série et sur un autre trip. Une seule photo pouvait remplir les 25 angles du gabarit, ou une photo d'un trip précédent ou de l'annonce publique pouvait servir de preuve. Un dommage ou un retard se jugeait alors sur une preuve douteuse.
2. **F-L3-PRE-02** : `InspectionService.addPhoto` appelait `preparePhoto` (retrait des métadonnées, dont le GPS) seulement pour juger le type et les dimensions, puis jetait la copie nettoyée. L'original était haché, scellé et stocké. Le dossier de preuve (US-308) le relisait et le rangeait dans l'archive remise à l'ops, puis à l'assureur partenaire. La position d'un particulier partait donc chez un tiers (L3-PM-06, Ley 81 au Panama, loi de protection des données au Paraguay).

Les deux correctifs se tiennent. Si la garde d'unicité portait sur l'empreinte de l'original, il suffirait de changer un octet de l'EXIF pour la contourner. Elle doit donc porter sur une empreinte stable : celle du contenu nettoyé.

## Décision

1. **Deux empreintes, deux rôles** :
   - empreinte de l'**original** (`sha256` envoyé par l'appareil) : contrôle de **transport** seulement. L'API la compare à la SHA-256 des octets reçus et refuse tout écart (`PHOTO_INVALID`, inchangé). Elle n'est jamais enregistrée ni rendue ;
   - empreinte de la **copie nettoyée** (`preparePhoto(...).body` : EXIF dont GPS, XMP, IPTC, MPF et commentaires retirés par liste blanche ; aucun pixel touché) : c'est la **seule** empreinte enregistrée (`file_asset.sha256`, `trip_ops_inspection_photo.sha256`), rendue (`sha256`, `bytes` de la réponse), et la seule copie analysée par l'antivirus, scellée par la clé USER de la personne et stockée. Le dossier de preuve la recalcule à l'identique (`INTEGRITY_MISMATCH` sinon, US-308) : aucun EXIF ni GPS n'en sort.
   - **Pourquoi pas l'original dans un champ restreint** (option ouverte par la red team) : aucune finalité. L'heure et la position retenues sont celles du serveur (16 TRP-004, 08 BR-PICKUP-03 : l'EXIF n'est qu'un indice, et l'heure de l'appareil est déjà reçue à part). Garder l'original ajouterait une donnée personnelle C2 à inventorier (US-111) sans servir de preuve. Comme Turo, la position n'est pas exposée.
2. **Garde d'empreinte déjà vue, en base** (0176) :
   - index **UNIQUE** `trip_inspection_photo_sha256_unique` sur `core.trip_ops_inspection_photo (sha256)` : une empreinte ne sert qu'**une** photo d'état, tous trips, toutes séries et toutes parties confondus, même angle compris ;
   - la commande lit d'abord l'empreinte, chez les photos d'état et chez les photos d'annonce (`audit_file_asset` du bucket `PUBLIC_LISTING`, même retirées ou refusées ; index partiel `file_asset_listing_sha256_idx` ; politique `cmd_hold_inspection_listing_sha_sel` : `cmd_hold_owner` lit `bucket` et `sha256` des seules lignes C0 publiques). Si elle est déjà vue : `PHOTO_DUPLICATE`, et **rien n'est écrit**. Le jeton de capture n'est pas consommé : l'angle se reprend avec une nouvelle photo ;
   - **concurrence** : deux envois simultanés du même fichier sur deux trips n'ont aucun verrou commun. Le second attend la transaction du premier sur l'index unique. Si le premier est validé, la violation d'unicité est rattrapée dans un bloc d'exception : ses trois écritures (`file_asset`, jeton, photo) sont annulées au point de sauvegarde, et l'issue est `PHOTO_DUPLICATE`. Si le premier est annulé, le second passe. Sur une même série, le verrou de la série (0158) sérialise les deux envois, et la lecture préalable voit le premier. Les photos d'annonce ne sont lues qu'avant l'écriture : une annonce est publique et publiée avant tout trip, il n'y a donc pas de course utile ;
   - la commande garde sa signature, son propriétaire, ses droits et sa place à l'allowlist `SECURITY DEFINER` (search_path figé). Elle a une issue de plus.
3. **API** : `PHOTO_DUPLICATE` (409, `common.inspection.photoDuplicate`, es, en, fr, pt-BR, catalogue v111), ajouté au contrat OpenAPI de `POST /trips/{tripId}/inspections/{kind}/photos`. Le FAKE du magasin applique la même règle.
4. **Comme Turo** (`docs/team/COMME_TURO.md`) : une reprise doit être une nouvelle prise, et une image déjà vue est refusée, même pour une reprise du même angle aux mêmes octets. La position GPS n'est pas exposée.

## Limite assumée

L'égalité d'octets ne reconnaît ni une image **réencodée** ni une image dont un **pixel** (ou un segment gardé, JFIF / Adobe / profil ICC) a changé. Une empreinte perceptuelle demanderait une bibliothèque d'image absente de la pile (ADR-099) : c'est une suite pour le BOARD (avec le stockage réel du lot C). 16 TRP-004 le dit déjà : l'empreinte prouve l'intégrité depuis la réception, pas l'absence de retouche avant l'envoi. La garde ferme l'attaque bon marché (le même fichier, ou le même fichier dont l'EXIF change) et le jeton de capture reste en place.

## Existant et migration

La bêta n'est servie nulle part : il n'y a aucune photo d'état en production. Les graines du test des migrations sur base peuplée (l0-us046) n'en écrivent aucune, et les preuves posent des octets aléatoires. Aucune étape expand / contract n'est donc nécessaire. Si des doublons existaient, `CREATE UNIQUE INDEX` échouerait et la migration serait refusée (fail-closed : rien n'est effacé ni masqué).

## Conséquences

- Preuves :
  - `l0-us303-photo-fingerprint` (rôles de production, PA / USD et PY / PYG, années virtuelles 2097). Partie A : autre angle, même angle, autre partie, autre trip, autre pays, photo d'annonce, rien d'écrit, jeton intact, index unique. Partie B : course à deux connexions, premier validé ou annulé ;
  - red team inversée : `rt-l3-01-preuves` › P03 et `l3-photo-exif`, où l'attaque est inchangée et les observations sont mises à jour, justification en commentaire ;
  - contrat `trip-inspection` : EXIF retiré, empreinte et taille de la copie nettoyée, doublon refusé même quand seul l'EXIF change.
- `audit-schema` : la nouvelle politique `_sel` de `cmd_hold_owner` est inscrite. La règle reste entière : jamais d'UPDATE, de DELETE ni d'ALL.
- Code PROPOSÉ à reporter dans 16 A.8 par l'orchestrateur : `PHOTO_DUPLICATE`.
