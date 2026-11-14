# ADR-123 — Catalogue de la douane partagé entre les pays, curation par lots et retour arrière de l'import

- **Statut** : PROPOSÉ (N-101, suite de l'import de la douane d'US-113 ; agent back-end, claude-opus-5-5, 2026-11-14). Revues exigées : voir la passation `docs/team/handoffs/N-101.md`.
- **Sources** : BOARD N-101 (revues de l'import #129 : architecture n° 2 et n° 4, code n° 3 et n° 4, qa n° 3) ; ADR-109 (import de la douane) ; ADR-094 (catalogue maison), ADR-081 (expand / contract), ADR-044 (migration appliquée immuable), ADR-024 (aucune constante pays) ; 17 §3.2.3 (`vehicle_variant.market`) ; CLAUDE.md, contraintes 3 et 9 (« comme Turo »).

## Contexte

L'import de la douane (0079) a chargé 52 marques, 642 modèles et 680 variantes sans fiche, toutes au marché de la **source** (le Paraguay). `listMakes`, `listModels`, `listVariants` et les fonctions de 0067, 0074, 0077 et 0083 ne proposent à un hôte que les variantes communes (`market` nul) ou de son pays : un hôte du Panama ne voyait aucun de ces modèles. Pourtant la douane dit qu'un modèle **existe et circule**, pas où il peut être loué ; l'occasion japonaise et les marques chinoises roulent dans les deux pays. La revue de code a aussi relevé trois défauts de curation, et l'architecture un retour arrière non écrit.

## Décision

1. **Catalogue partagé** (PROPOSÉ, « comme Turo » : un seul catalogue marque / modèle, sans restriction de pays ; inscrit à `COMME_TURO.md`). Migration **0095** : `market` rendu nul pour les variantes de la source `DNIT_ADUANAS_PY` qui en portaient un. Une instruction, une colonne, aucune ligne ajoutée ni retirée ; aucun code pays écrit (la ligne est désignée par sa source). Dérogation `data-update` nominative (`expand-contract-allowlist.json`). Aucune raison métier contraire : ce qui garde la publication reste propre au pays (interrupteurs, contrat de l'assureur, classe de valeur, N-83), jamais le marché d'une variante. Le marché par pays reste possible pour une ligne qui en a vraiment un (file d'ajout `HOST_REQUEST`, 0074).
2. **Lots** : une migration appliquée est immuable. Une ligne ajoutée après 0079 porte `lot` dans `vehicle-catalog-dnit.json` ; `customs-import.ts` rend chaque lot dans **sa** migration (`CUSTOMS_MIGRATIONS` : lot 1 → 0079, rendu inchangé octet pour octet ; lot 2 → **0096**). Dès `sharedFromLot` (2), la variante est insérée commune. Le générateur refuse un lot inconnu, un modèle d'un lot antérieur à celui de sa marque, un lot sur une ligne de la v1.
3. **Curation, lot 2** (relue sur les libellés bruts du CSV) :
   - **JMC Vigor rétabli** (« CAMIONETA DOBLE CABINA MARCA JMC, MODELO VIGOR », 34 unités, 2015–2018). Le lot 1 l'avait écarté comme mot de déclaration. Variante dès 2014, ouverte : aucune année-modèle n'est lue, même règle qu'ADR-109 §3.
   - **« Chevrolet Trucker » → Tracker** et **« Ford Sport » → EcoSport** : rapprochements **confirmés**. Les libellés bruts sont « CHEVROLET TRUCKER LS 1.2 FLEX TURBO », une coquille, et « MODELO ECO SPORT 1.4L ».
   - « Chery Face », un modèle commercialisé, et « Mini JCW », une finition vendue comme modèle, sont gardés : un hôte les cherche sous ce nom, et les retirer demanderait un `UPDATE` sans gain.
4. **Empreinte de la source** : `sourceSha256` dans le fichier de données, calculée par `dnit-import.mjs` (SHA-256 de l'extrait du 2026-11-12 : `e72363ee…401a`) et validée par le générateur. Rejouer le script sur un autre extrait change l'empreinte, ce qui se voit au diff.
5. **Retour arrière** (complète ADR-109) :
   - **De l'import** : `status = 'RETIRED'` sur les lignes de la source, jamais de `DELETE` (garde de 0063). Une migration revue, avec une dérogation `data-update`.
   - **Des `NOT NULL` de 0063** : impossible tant qu'une ligne sans fiche existe, **même retirée**. La contraction exige d'abord une migration revue qui complète la fiche de ces lignes ; une ligne sans fiche ne se supprime pas.
   - **Du partage** : rendre le marché de la source par une migration revue, seulement si aucun véhicule d'un autre pays ne référence ces variantes. Sinon, garder le partage ou retirer la variante.
   - La fixture **9953** joue ce retour arrière sous `migrator` puis l'annule : tout est retiré, `DELETE` est refusé et les deux `SET NOT NULL` échouent.

## Conséquences

- Un hôte du Panama, comme un hôte du Paraguay, trouve les 52 marques et les 643 modèles de la douane (lot 2 compris). Les 681 variantes sont communes.
- Le parcours jusqu'à l'annonce publique est prouvé sur une variante sans fiche, au PA et au PY (Geely Coolray). Si la classe de valeur est inconnue, le refus est `VEHICLE_NOT_COVERED` (N-83, l'annonce reste DRAFT). Avec une classe connue et le véhicule confirmé, l'annonce passe LISTED et sa fiche publique est lisible : marque et modèle viennent du catalogue, boîte, places et carburant de l'hôte.
- Tests : `customs-import.test.ts` (lots, rendu par migration, JMC Vigor commun, empreinte, refus fail-closed) ; `vehicle-catalog.int.test.ts` (chaque pays voit les marques, Premio, Hilux ancien et Vigor) ; `l0-n101-catalogue-pa.test.ts` (partage, retour arrière, parcours) ; `l0-us113-*` adaptés.
- Effet de bord corrigé dans les tests : des sélecteurs prenaient « la première variante commune » et supposaient qu'elle avait une fiche (fixtures 9982 et 9985, L0 d'US-108, US-114, US-115 et US-126). Ils exigent désormais `transmission IS NOT NULL`.
- Aucun texte visible nouveau, aucune donnée personnelle.

## Limites et reports

- **Classe de valeur** des modèles de la douane : nulle, donc jamais publiables tant que N-83 n'est pas tranché (assureur, fondateur).
- **Source équivalente du Panama** (registre ou douane) : toujours à trouver. Les années indicatives de la douane du Paraguay valent pour les deux pays.
- **Spécification** : à reporter dans `docs/specs/sources/SRC_VEHICLE_DATA.md` et 17 §3.2.3. Les points sont la valeur `DNIT_ADUANAS_PY`, les colonnes facultatives, le catalogue commun, les lots et l'empreinte. Il faut une demande de fusion revue de `docs/specs/`, non faite ici.
