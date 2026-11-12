# ADR-112 — Numéro de châssis en deux formats (VIN ISO 3779 ou non ISO) et historique des engagements de l'hôte

- **Statut** : PROPOSÉ (correctif d'US-124, agent back-end, claude-opus-5-5, 2026-11-12). Complète ADR-107. Revues exigées (`review-requirements.json`, story US-124) : code, architecture, **sécurité**, ux, qa ; sécurité sur un autre modèle que l'auteur.
- **Sources** : revues de la seconde passe d'US-124 (code 3, architecture 4, ux 3, qa 6, sécurité 5) ; 08 BR-LIST-04 ; 16 HST-011, HST-019 ; ISO 3779 ; DEC-FONDATEUR-22 (« jamais plus lourd que Turo ») ; consentement versionné des CGU (US-102, US-126, ADR-100).

## Contexte

0067 et 0077 imposaient, pour tout véhicule produit à partir de 1981, un VIN ISO 3779 de 17 caractères, règle codée en dur dans le SQL (et dans `normalizeVin` de l'API), avec la réponse générique `VEHICLE_FIELD_REQUIRED`. Les châssis courts des importations japonaises (« GRJ150-0012345 » : code modèle, tiret, numéro de série), courants au Paraguay (véhicules d'occasion arrivés du Japon par le Chili), étaient bloqués sans explication. Les engagements de l'hôte (`ownership_attested_at`, `lien_attested_at`) étaient réécrits à chaque déclaration, sans le libellé accepté.

## Décision

1. **Deux formats acceptés**, sans année ni pays (migration 0083, `core.catalog_vin_kind`) :
   - **VIN ISO 3779** : 17 caractères, ni I, ni O, ni Q. Le **chiffre de contrôle** (position 9) **n'est pas vérifié** : il n'est obligatoire qu'en Amérique du Nord (FMVSS / CMVSS), pas au Panama ni au Paraguay, et des véhicules importés d'autres marchés ne le respectent pas.
   - **Numéro non ISO** : 5 à 16 lettres ou chiffres une fois normalisé (le châssis japonais « GRJ150-0012345 » devient `GRJ1500012345`).
   - Un numéro de **17 caractères est lu comme un VIN ISO** : avec I, O ou Q, il est refusé. 4 caractères ou moins, 18 ou plus, ou un caractère hors lettres, chiffres, espaces et tirets : refusé.
2. **Normalisation inchangée** (`core.catalog_normalize_vin`, 0067 ; `normalizeVin` de l'API) : majuscules, **sans espace ni tiret**. Le tiret du châssis japonais est un séparateur, pas un caractère distinctif : le retirer rend l'**unicité** (index `catalog_vehicle_vin_unique`) et la **contestation N-61** indifférentes à la saisie (casse, espaces, tirets), pour les deux formats, et laisse intactes les contraintes de forme de 0067 et 0077 (`^[A-Z0-9]{5,17}$`).
3. **Règle retirée du code** : la contrainte `catalog_vehicle_vin_iso` est recréée sous son nom avec les deux formats et sans année ; `catalog_cmd_create_vehicle` et la déclaration répondent **`VEHICLE_VIN_INVALID`** (422, `common.vehicleDocs.vinInvalid`, es / en / fr / pt-BR) ; l'API ne juge plus que les caractères. À la soumission, le numéro est exigé **pour tout véhicule** (`VEHICLE_FIELD_REQUIRED`), plus seulement à partir de 1981 : tout véhicule porte un numéro de châssis, et l'âge maximal du pays écarte de toute façon les véhicules anciens. Aucun paramètre par pays n'est créé : aucun des deux pays n'a de raison connue de refuser l'un des formats ; un pays qui l'exigerait ajouterait un paramètre fail-closed.
4. **Écrans** : aide sous le champ (création du véhicule A10 et déclaration) avec un exemple de chacun des deux formats ; le refus `VEHICLE_VIN_INVALID` s'affiche sous le champ.
5. **Engagements historisés** (`core.catalog_vehicle_attestation`, ajout seul, RLS `ENABLE` + `FORCE`, aucun droit applicatif, déclencheurs anti-UPDATE / DELETE / TRUNCATE) : chaque engagement pris (« propriétaire ou autorisé » ; « non gagé ou accord du créancier » pour un véhicule financé) ajoute une ligne : auteur, pays, clé du catalogue, **version du catalogue, langue et libellé exact affiché**, horodatage `platform.now()`. Comme pour les CGU, la langue vient de l'écran (`locale`, défaut `es`, qui fait foi) et le libellé est lu par l'API dans `@rueda/i18n` (le même paquet que le site), jamais fourni par le navigateur. Les colonnes `*_attested_at` du véhicule gardent le dernier engagement.
6. **Signatures** : nouvelle `core.catalog_cmd_declare_vehicle(…, p_locale, p_catalog_version, p_ownership_text, p_lien_text)` (libellé obligatoire, sinon `VEHICLE_FIELD_REQUIRED`) ; l'ancienne signature reste servie pour la version N de l'API (retour arrière) et historise l'engagement sans libellé (colonnes NULL ensemble, contrainte `catalog_vehicle_attestation_wording`). Corps commun : `core.catalog_vehicle_declare`, aide interne non exécutable par un rôle applicatif.

## Conséquences

- Un hôte au châssis court n'est plus bloqué (DEC-FONDATEUR-22) ; un VIN ISO mal saisi reçoit un message qui dit quoi corriger.
- Risque accepté : un VIN ISO tronqué (16 caractères) passe pour un numéro non ISO. L'unicité et la contestation N-61 restent la réparation, comme pour toute fausse déclaration (ADR-107, risque résiduel).
- La version N de l'API rend `VEHICLE_VIN_INVALID` en 503 (`LISTING_UNAVAILABLE`, issue inconnue) pendant un retour arrière : rien n'est écrit.
- Les engagements sont opposables : on sait quel texte, dans quelle langue et dans quelle version, l'hôte a coché, et quand.
- Suites : l'adresse IP et l'agent du navigateur ne sont pas conservés (comme le relevait la revue sécurité) ; à ajouter si le juridique le demande.
