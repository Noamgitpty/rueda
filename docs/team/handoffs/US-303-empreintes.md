# Passation US-303 (suite) — empreinte de photo unique et photos sans EXIF (F-L3-PRE-01, F-L3-PRE-02) (2026-11-22, agent backend, claude-opus-5-5)

Branche `story/US-303-empreintes-exif`, partie d'`origin/main` (`45f9e1c4`). Worktree `../wt/US-303-empreintes`. La branche fusionne `story/US-313-redteam` (PR n° 289, pas encore fusionnée) pour inverser ses `it.fails`. Si #289 fusionne d'abord, son diff disparaît du nôtre ; sinon, les deux PR fusionnent ensemble. Décision : **ADR-196** (PROPOSÉ, comme Turo).

## Numéros

Migration **0176**, **ADR-196**, catalogue **v111**, fixture **9908**, tous réservés par l'orchestrateur. US-706 (0177) et US-318 (0178) fusionnent après cette PR. Années virtuelles des preuves : **2097**.

## Fait

- **F-L3-PRE-02 (élevé)** : `InspectionService.addPhoto` hache, analyse, scelle et stocke `preparePhoto(...).body`, la copie sans EXIF ni GPS. La réponse rend l'empreinte et la taille de cette copie. L'empreinte de l'appareil (sur l'original) sert seulement au contrôle de transport (`PHOTO_INVALID` si elle diffère) et n'est jamais enregistrée. L'original n'est pas gardé : aucune finalité (heure et position du serveur), aucune donnée C2 de plus (ADR-196 §1).
- **F-L3-PRE-01 (élevé)** : migration 0176.
  - Index UNIQUE `trip_inspection_photo_sha256_unique` sur l'empreinte des photos d'état.
  - Lecture préalable des photos d'état et des photos d'annonce (index partiel `file_asset_listing_sha256_idx` ; politique `cmd_hold_inspection_listing_sha_sel`, SELECT des lignes PUBLIC_LISTING seulement).
  - Empreinte déjà vue ⇒ `PHOTO_DUPLICATE` (409, es, en, fr, pt-BR). Rien n'est écrit et le jeton reste valable.
  - Course entre deux connexions : la violation d'unicité est rattrapée au point de sauvegarde (bloc d'exception).
  - La commande est remplacée à signature, propriétaire, droits et entrée d'allowlist identiques. La garde porte sur l'empreinte de la copie nettoyée : changer un octet d'EXIF ne la contourne pas (prouvé au contrat).
- Existant : aucune photo d'état en production, aucune dans les graines l0-us046, des octets aléatoires dans les preuves. Aucune expand / contract n'est nécessaire. Un doublon ferait échouer la migration (fail-closed).
- Tests :
  - `l0-us303-photo-fingerprint`, PA et PY. Partie A : six cas de doublon, rien d'écrit, jeton intact, index. Partie B : deux connexions, premier validé ⇒ `PHOTO_DUPLICATE`, premier annulé ⇒ `DONE`, attente observée dans `pg_locks`.
  - Red team inversée sans toucher à l'attaque : `rt-l3-01-preuves` › P03 et `l3-photo-exif` passent de `it.fails` à `it`. Les deux observations sont mises à jour, justification en commentaire : elles affirment désormais l'issue exacte (`PHOTO_DUPLICATE` ; objet et empreinte de la copie nettoyée).
  - Contrat `trip-inspection` : une photo distincte par angle au critère 1, deux tests ajoutés (EXIF retiré ; doublon, même quand seul l'EXIF change).
  - `audit-schema` : la nouvelle politique `_sel` est inscrite ; la règle reste entière.
- Docs : ADR-196, README de TRP et de `packages/db`, `changelog.d/US-303-empreintes-exif.md`, COMME_TURO (2 lignes), OpenAPI (409 `PHOTO_DUPLICATE`, résumé), `api.md` régénéré, `schema.md` recopié du job « base de données ».

## Écarts et suites (PROPOSÉ)

- Code `PHOTO_DUPLICATE` à reporter dans 16 A.8.
- Limite : une image réencodée ou retouchée d'un pixel n'est pas reconnue. Une empreinte perceptuelle demande une bibliothèque d'image (ADR-099) : suite à ouvrir au BOARD, avec le stockage réel (lot C).
- RISKS : L3-PM-03 et L3-PM-06 passent de « réalisé » à « corrigé » (à reporter par l'orchestrateur) ; N-xxx-A et N-xxx-B de la red team sont fermés par cette PR.
