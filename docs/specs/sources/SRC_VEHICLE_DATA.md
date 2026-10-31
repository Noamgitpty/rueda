# SRC_VEHICLE_DATA — Sources de données pour le catalogue véhicules (marques, modèles, années, caractéristiques)

Date de recherche : 30/10/2026. Auteur : analyste sourcing (agent). Alimente : 17 (entité `catalog.vehicle`, import CSV `fleet_import_job`), 04 (HST-007, HST-011, FLT-011, LST-004, SRC-033), 18 (MVP).

> **Note d'alignement (2026-10-30, rédacteur technique final — le texte source ci-dessous n'est pas réécrit)** : les noms canoniques sont ceux de `17_DATA_MODEL_AND_ARCHITECTURE.md` v5 (§8.1 module CAT, ADR-034). L'expression « entité `catalog.vehicle` » ci-dessus désigne la table `vehicle` du module/schéma CAT (`catalog`), c'est-à-dire le véhicule **de l'agence** ; le **catalogue de référence** est porté par quatre tables distinctes : `vehicle_make`, `vehicle_model`, `vehicle_variant`, `catalog_addition_request`, reliées par `vehicle.variant_id` (nullable). Voir aussi la note en tête du §6. Inventaire : HST-050 (04).

Convention de preuve : **CONFIRMÉ** = lu sur la page officielle de la source lors de cette recherche (URL citée) ; **À VALIDER** = non lu sur les conditions officielles (page inaccessible, absente ou seulement relayée par un tiers) ; **INFÉRÉ** = déduction. Aucun prix n'est inventé : « inconnu » = non publié sur les pages lues. Aucun blocage contourné, aucune inscription faite. Cette note n'est pas un avis juridique.

## 1. Besoin (rappel tiré de 12, 13, 04)

- Marché neuf Panama 2025 : SUV 55,9 % des ventes, pick-ups en hausse, marques asiatiques en forte croissance (12 §1, DOCUMENTÉ-SECONDAIRE). Paraguay 2025 : SUV 57,8 %, pick-ups 23,8 %, top modèles Toyota Hilux, Chevrolet S10, Fiat Strada ; beaucoup d'occasions importées (« chileré », origine japonaise) (13 §1, DOCUMENTÉ-SECONDAIRE).
- Le catalogue doit servir : (a) le wizard véhicule HST-011 (choisir marque/modèle/année/finition au lieu de saisir du texte libre), (b) les filtres de recherche (SRC-011, SRC-023, LST-004 : sièges, carburant, consommation, boîte), (c) les pages SEO marque/modèle (SRC-033), (d) l'import CSV de flotte FLT-011 (P0 : 5 à 10 agences de 10 à 300 véhicules) avec validation de chaque ligne contre le catalogue, (e) HST-007 (décodage VIN, P1) dont la note du 04 dit « couverture VIN des véhicules LATAM à vérifier ».
- Test de couverture retenu (modèles du marché) : Toyota Hilux / Fortuner / Rush / Yaris, Suzuki Swift / Vitara, Hyundai Creta / Accent, Kia Picanto, Nissan Frontier / Kicks, Chevrolet Onix / S10, Mitsubishi L200, Fiat Strada, marques chinoises (Chery, JAC, Great Wall, Changan, BYD, Geely).

## 2. Constat clé

1. **Aucune source gratuite ne couvre bien le parc LATAM.** Les bases publiques (NHTSA, EPA) décrivent les véhicules vendus aux États-Unis ; or plusieurs modèles du test (Hilux telle que vendue ici, Rush, Creta, Picanto, Onix, L200, Strada, la plupart des modèles chinois) ne sont pas ou pas sous cette forme sur le marché américain (INFÉRÉ ; à tester par échantillon).
2. **Les fiches techniques varient selon le pays de vente** pour un même nom de modèle (Teoalida le dit explicitement, voir §4.7). Même une base payante « Europe » ou « États-Unis » ne décrit pas fidèlement un Hilux paraguayen.
3. **Un catalogue de marques/modèles/années assez fin pour des filtres** (catégorie, places, portes, boîte, carburant, 4x4) est petit : quelques centaines de lignes « modèle-génération » suffisent. Il est donc réaliste de le **curer à la main** à partir d'un squelette libre de droits, plutôt que d'acheter une base mondiale dès le MVP.

## 3. Tableau comparatif

| # | Source | Type | Couverture LATAM (test §1) | Champs utiles | Licence / usage commercial | Coût | Accès | Mise à jour | Décodage VIN |
|---|---|---|---|---|---|---|---|---|---|
| 1 | NHTSA vPIC | API gouv. US + bases téléchargeables | Faible : seulement les véhicules enregistrés pour le marché US (FAQ officielle). Marques LATAM-only absentes | Marque, modèle, année (>1995 pour les modèles), type de véhicule, carrosserie, moteur, carburant, transmission, portes, entraînement via VIN | Gratuit, sans inscription (FAQ). Licence formelle non lue : À VALIDER (données ouvertes US) | Gratuit | API REST (sans clé) + bases autonomes téléchargeables | Version 4.10, dernier changement de code 17/10/2026 | Oui, fiable ≥ MY1995 pour les VIN US ; VIN non US souvent partiels |
| 2 | EPA fueleconomy.gov | Web services + CSV | Faible (marché US) | Marque, modèle, année, cylindrée, cylindres, entraînement, boîte, carburant, consommation ville/route/mixte, classe EPA, volume habitacle et coffre | Page sans conditions affichées : À VALIDER (œuvre d'agence fédérale US, à confirmer) | Gratuit | `vehicles.csv` (1984–courant) + JSON/XML | Mise à jour affichée 29/09/2026 | Non |
| 3 | Wikidata | Base de connaissances ouverte | Variable, très inégale (modèles de production mondiaux souvent présents, spécifications souvent absentes) : INFÉRÉ, à mesurer par SPARQL | Marque, modèle, génération, carrosserie, parfois images (Commons, licences variables) | CONFIRMÉ : données en CC0 (domaine public), sans obligation d'attribution (page Licensing). Les images Commons ont leurs propres licences | Gratuit | SPARQL, dumps | Continue (communautaire) | Non |
| 4 | CarQuery API | API (marque/modèle/trim) | Inconnue ; couverture et état de maintenance non vérifiables | Années, marques, modèles, trims, fiche modèle (selon la doc relayée par des tiers) | À VALIDER : le certificat TLS de carqueryapi.com ne correspond pas au domaine (erreur à la récupération) ; conditions non lues ; un tiers dit « gratuit », non confirmé | Inconnu | API JSON (limite 500 enregistrements par requête selon la doc relayée) | Inconnue (projet possiblement inactif, INFÉRÉ) | Non |
| 5 | CarAPI (carapi.app) | API payante | Faible : « véhicules vendus aux États-Unis » (page tarifs) | Année/marque/modèle 1900–2027 ; sous-modèles (Plus) ; trims, carrosserie, moteur, 1990–2027 (Premium) | Page tarifs muette sur l'usage commercial ; conditions non lues : À VALIDER. Mise en cache autorisée (page tarifs) | Base 199 $/an (1 500 appels/jour), Plus 249 $/an (3 000), Premium 299 $/an (6 000) ; page incohérente sur les fonctions incluses | API ; « Data Feed » CSV/XLS vendu à part, prix inconnu | Quotidienne « quand disponible » | VIN US 1990–2027 |
| 6 | API Ninjas Cars | API freemium | Inconnue ; page annonce plus de 400 constructeurs, sans liste de pays ; source non nommée | Marque, modèle, génération, carrosserie, portes, boîte, rapports, entraînement, carburant, puissance, cylindrée, cylindres, fiche détaillée (consommation, dimensions, sièges en valeur+unité) | CONFIRMÉ (page terms) : gratuit = non commercial ; payant = commercial tant que l'abonnement est actif, interdiction de bâtir une base ou un service concurrent, licence révocable qui cesse avec l'abonnement. Stocker un catalogue dérivé serait donc risqué | Prix payants : inconnus (non lus) ; gratuit non commercial | API ; l'id voiture peut être stocké | « Rafraîchissements périodiques » | Non |
| 7 | Teoalida / « Car Database Atlas » | Bases achetées (XLS, CSV, SQL) | **Pas de base Amérique latine** (le vendeur le dit). Bases : US 1990–2027 (123 colonnes), Europe (311+), Japon JDM (100), Inde, Moyen-Orient, UK ; liste mondiale « Car Models List » (marque + modèle) | Très riches (carrosserie, places, etc.) mais selon le marché choisi | Conditions de la page `terms` non lues : À VALIDER (redistribution, usage SaaS) | Seul prix lu : 12 € pour la base Année-Marque-Modèle 2024–2027 ; autres prix : inconnus ; abonnement 1 an, renouvellement −50 % | Fichiers + conversion à la demande | Mensuelle à annuelle selon la base | Non |
| 8 | JATO Dynamics | Données pro, API (JaaS / Web APIs) | Plus de 50 marchés ; Panama et Paraguay **non confirmés** (page non lue en détail) ; bureau au Brésil | Plus de 1 000 données par véhicule, options, prix, photos | Contrat commercial : À VALIDER | Inconnu (sur devis) | API / compte | Continue | Non vérifié |
| 9 | Autodata (Group) | Données techniques de réparation | Non vérifiée pour LATAM ; vocation atelier, pas catalogue de location | Données techniques d'entretien | Abonnement : À VALIDER | Pages d'abonnement avec prix en USD vus, marché non précisé : inconnu | Abonnement web | n.d. | Non |
| 10 | Auto Care VCdb (Amérique latine) | Base standard de l'après-vente | Plus de couverture LATAM : Argentine, Brésil, Chili, Colombie, Costa Rica, Équateur, Pérou, puis Bolivie, Rép. dominicaine, Guatemala, **Panama** (2022) ; Paraguay non cité | Configurations véhicule orientées pièces, pas fiche loueur | Abonnement membre/licence : À VALIDER (contact technology@autocare.org) | Inconnu | Fichiers | Continue, annonces de 2021–2022 | Non |
| 11 | Décodeurs VIN commerciaux (CarsXE, Vincario, VinAudit, DataOne, etc.) | API payantes | CarsXE annonce 83 % de couverture Amérique du Sud (son propre chiffre, non vérifié) ; VinAudit : US/Canada ; DataOne : rien trouvé de public | Marque, modèle, année, moteur, parfois équipements | Chaque contrat : À VALIDER | Vincario : 0,90 € la requête sur un palier de 5 000 (chiffre relayé, non vérifié sur le site) ; autres : inconnu | API | n.d. | Oui, mais couverture LATAM à tester VIN par VIN |
| 12 | Jeux de données GitHub / Kaggle / Back4App | Fichiers ouverts | Faible (copies de données US) | Selon le jeu ; sièges absents dans les jeux vus | `ajhenry/searchable-car-database` : MIT annoncée (dérivée de fueleconomy.gov, 1987–2021) ; `us-car-models-data` : licence « other » ; Back4App « car make model » : « open source » sans licence nommée, véhicules fabriqués aux États-Unis 1992–2022. À VALIDER pour chaque dépôt | Gratuit | Téléchargement | Figés | Non |
| 13 | Sites constructeurs locaux (Toyota Panamá, Hyundai Paraguay, etc.) | Pages commerciales | La meilleure fidélité pour les modèles réellement vendus ici | Versions locales, photos, fiches | Droit d'auteur du constructeur sur les textes et photos ; conditions de chaque site non lues : À VALIDER | Gratuit à consulter | Pas d'export | À chaque lancement | Non |

## 4. Évaluation légale / licence par source

### 4.1 NHTSA vPIC — usage : squelette marques + décodage VIN partiel
- CONFIRMÉ (FAQ officielle) : service gratuit « dans le cadre des initiatives Open Data », sans enregistrement de l'application, pas de plafond quotidien, gros lots à lancer de nuit (heure de l'Est) ou en week-end. CONFIRMÉ : les véhicules étrangers ne figurent que si le constructeur les a enregistrés pour le marché US.
- À VALIDER : texte de licence explicite et redistribution d'une copie locale. Les données d'un organisme fédéral américain sont en général dans le domaine public (INFÉRÉ ; la page lue n'affiche aucune licence).
- Risque produit : un VIN d'un véhicule non vendu aux États-Unis renvoie des champs vides ; ne jamais en faire une condition bloquante.

### 4.2 EPA fueleconomy.gov — usage : consommation et classes pour les modèles communs
- CONFIRMÉ : fichiers et services publics. Aucune licence affichée sur les pages lues (service et téléchargement) : À VALIDER.
- Limite : consommation en mpg d'un cycle américain ; pour un Hilux local, c'est un indicatif seulement. Champ « consommation » à marquer `source = EPA_US_REFERENCE`.

### 4.3 Wikidata — usage : liste libre de marques/modèles, noms et liens
- CONFIRMÉ (Wikidata:Licensing) : données en CC0 ; l'attribution n'est pas exigée. Les textes hors espace principal sont en CC BY-SA 4.0. Les images de Commons ont chacune leur licence : ne pas les réutiliser sans vérification.
- Limite : couverture et qualité hétérogènes ; à mesurer sur la liste de test §1 avant tout import.

### 4.4 CarQuery — À VALIDER
- Impossible d'ouvrir le site (erreur de certificat, non contournée). Conditions non lues. Ne pas bâtir sur cette source sans nouvelle vérification de l'état du projet.

### 4.5 CarAPI — À VALIDER
- CONFIRMÉ sur la page tarifs : prix annuels ci-dessus, couverture « véhicules vendus aux États-Unis », cache autorisé. Conditions d'utilisation et droits sur une copie locale : non lues, À VALIDER. Peu d'intérêt pour le test LATAM.

### 4.6 API Ninjas — CONFIRMÉ restrictif
- Le gratuit exclut tout usage commercial ; le payant n'autorise l'usage que pendant l'abonnement, interdit de construire une base concurrente et révoque le droit sur les données à la fin de l'abonnement. Incompatible avec un catalogue interne durable. À écarter pour l'amorçage ; au mieux un outil de contrôle ponctuel sur abonnement.

### 4.7 Teoalida — À VALIDER (conditions non lues)
- CONFIRMÉ (pages du vendeur, via recherche) : pas de base LATAM ; l'auteur recommande de ne pas mélanger les marchés car les fiches varient selon le pays ; il fournit une extension pour les modèles produits en Inde/Brésil/Argentine et déconseille de la considérer comme une base LATAM.
- À vérifier avant tout achat : droit de stocker dans une base SaaS multi-clients, d'afficher publiquement, de sous-licencier.

### 4.8 JATO, Autodata, VCdb, décodeurs VIN — À VALIDER (contrat)
- Tous exigent un contrat. Points à faire écrire : stockage permanent autorisé après résiliation, affichage public sur le site, usage par des tiers (agences), couverture Panama et Paraguay par pays, photos libres de droits.

### 4.9 Jeux GitHub / Kaggle / Back4App — À VALIDER
- Une licence MIT sur un dépôt n'efface pas les droits de la source d'origine (ici une donnée gouvernementale US, donc peu risquée, mais à contrôler). Les jeux sans licence nommée sont à écarter.

### 4.10 Scraping de Turo, d'annonces et de sites constructeurs
- **Turo — CONFIRMÉ interdit.** Les CGU (rubrique « Your Commitments », sous « Interfere with the operation of the Services ») interdisent de récupérer systématiquement des données ou contenus pour constituer une collection, une base ou un annuaire, manuellement ou par « bots, crawlers, spiders », ainsi que de contourner les en-têtes d'exclusion des robots et de refléter ou encadrer le service (lu sur une copie archivée tierce, tostracker.app, car turo.com renvoie 403 aux accès automatisés ; cohérent avec 02 et SRC_TOS_NOTES). **Conséquence : ne pas aspirer le catalogue ni les annonces Turo, ni s'en servir comme source de modèles.** Voir aussi les prestataires de scraping de Turo vendus en ligne : leur existence ne vaut pas autorisation.
- **Encuentra24 et Clasipar — À VALIDER.** Leurs conditions n'ont pu être lues (Encuentra24 : 403 ; Clasipar : introuvable par recherche). Hypothèse de travail : traiter comme interdit, sauf accord écrit. Les annonces contiennent aussi des données personnelles (vendeur), et le droit des bases de données peut s'appliquer (INFÉRÉ). Usage autorisé : lecture manuelle ponctuelle par un humain pour **établir la liste des modèles à curer**, sans copie de textes ni de photos ; et partenariat commercial si la valeur se confirme.
- **Sites constructeurs locaux — À VALIDER.** Lecture manuelle pour vérifier les versions locales : acceptable (INFÉRÉ). Aucune aspiration automatisée, aucune réutilisation de leurs photos (droit d'auteur).
- **Photos :** aucune des sources gratuites ci-dessus ne fournit de photos réutilisables. Le MVP s'appuie sur les photos de l'agence (HST-012, ≥ 6 obligatoires, chargées par l'ops en bêta). Pas de photo « catalogue » au MVP.

## 5. Approche recommandée pour le MVP

**Principe : un catalogue maison, petit et curé, amorcé par des sources libres, enrichi par l'administration et par l'import des agences. Pas de licence de base payante au MVP.**

1. **Squelette** : marques et noms de modèles issus de Wikidata (CC0) et de la liste NHTSA (vérifier la licence, À VALIDER), pour avoir des noms normalisés, pas de fiche complète.
2. **Liste curée d'environ 150 modèles locaux** (priorité aux ventes de 12 et 13) saisie par l'ops à partir de fiches publiques lues à la main, avec pour chaque ligne : marque, modèle, générations/années présentes, carrosserie, places, portes, boîtes, carburants, 4x4/AWD, cylindrées. Composition indicative (INFÉRÉ ; classement exact à produire avec des statistiques d'immatriculation, À VALIDER) : pick-ups (Toyota Hilux, Chevrolet S10, Fiat Strada, Mitsubishi L200, Nissan Frontier, Ford Ranger, Isuzu D-Max, VW Amarok) ; SUV (Toyota Fortuner / Rush / RAV4 / Raize, Hyundai Creta / Tucson, Kia Sportage / Seltos, Nissan Kicks, Suzuki Vitara / Jimny, Chevrolet Tracker, Mitsubishi Outlander / ASX) ; citadines et berlines (Kia Picanto, Hyundai Accent / HB20, Chevrolet Onix, Suzuki Swift, Toyota Yaris / Corolla, Nissan Versa) ; minivans et vans (Toyota Hiace, Hyundai H1) ; marques chinoises (Chery Tiggo, JAC, Great Wall Haval / Poer, Changan, BYD, Geely) ; importations d'occasion japonaises courantes au Paraguay (modèles à lister depuis l'ops terrain).
3. **Compléments gratuits** : consommation et volumes de coffre EPA lorsque le modèle existe aux États-Unis, marqués `source = EPA_US_REFERENCE`, toujours modifiables par l'ops.
4. **Ajouts administrés** : si l'hôte ne trouve pas son modèle, il choisit « Autre » avec marque/modèle libres, la demande va dans une file d'ajout à valider par l'ops (SLA à définir) ; une fois approuvée, elle rejoint le catalogue et les filtres.
5. **Import CSV agence (FLT-011)** : colonnes marque, modèle, année, finition, plaque, VIN ; chaque ligne est rapprochée du catalogue (exact, puis normalisé sans accents/casse, puis alias) ; les lignes non reconnues entrent en file d'ajout, jamais en annonce publiée directement. Fournir un modèle de CSV et un rapport d'erreurs par ligne.
6. **Décodage VIN (HST-007)** : reste P1. Appel NHTSA vPIC en best effort pour pré-remplir ; si le résultat est vide ou partiel, l'hôte choisit à la main. Jamais bloquant, jamais source unique d'éligibilité.
7. **Interdits** : aspiration de Turo, d'Encuentra24, de Clasipar ou de sites constructeurs ; copie de photos de tiers ; stockage de réponses d'API sous licence non commerciale.

## 6. Modèle de données minimal du catalogue (à injecter dans 17, domaine CAT)

Entités proposées (noms indicatifs, à caler sur les noms canoniques de 17) :

> **Note d'alignement sur 17 v5 (2026-10-30 ; la liste ci-dessous reste la proposition d'origine)** — en cas d'écart, **17 fait foi** :
> - `vehicle_make`, `vehicle_model`, `vehicle_variant` : 17 ajoute `source_ref` et `license_note NN` sur les trois tables (`source NN` aussi) ; `source` prend les valeurs `WIKIDATA`, `NHTSA_VPIC`, `OPS_CURATED`, `AGENCY_REQUEST` ; `vehicle_model` a UQ `(make_id, slug)` ; `vehicle_variant` a `CHECK (year_to IS NULL OR year_to >= year_from)` et `consumption_source` ∈ {`EPA_US_REFERENCE`, `OPS_CURATED`} ; le champ dérivé `has_4x4` n'est **pas** stocké dans 17 (il se déduit de `drive = '4X4'`) ; `created_at` est une colonne transverse.
> - `catalog_addition_request` : 17 ajoute `origin` (`WIZARD_OTHER`, `FLEET_IMPORT`, `OPS`), `fleet_import_job_id`, `reviewed_at`, `sla_due_at` (paramètre `catalog_addition_sla_business_h`, PROPOSÉ 24) ; `status` ∈ {`OPEN`, `APPROVED`, `MERGED`, `REJECTED`} ; la file ops passe par `review_queue_item` de type `CATALOG_ADDITION`.
> - `vehicle` : conforme (`variant_id` nullable, `make_text` / `model_text` de repli, `year`, `trim_override`) ; `fleet_import_job` porte `rows_unmatched`.
> - La question « publier un véhicule sans variante ? » (§8 ci-dessous) est **décidée** : un véhicule sans variante de catalogue n'est jamais publiable (22 OQ-CAT-01 (g), 17 ADR-034, 04 HST-011 / FLT-011). Les licences NHTSA / EPA restent À VALIDER (OQ-CAT-01 a–b).

- `vehicle_make` : `id`, `slug`, `name`, `country_origin` (optionnel), `aliases[]`, `status` (ACTIVE, PENDING_REVIEW, RETIRED), `source`, `created_at`.
- `vehicle_model` : `id`, `make_id`, `slug`, `name`, `aliases[]`, `body_type` (SUV, PICKUP, SEDAN, HATCHBACK, VAN, MINIVAN, COUPE, CONVERTIBLE, WAGON), `category_default` (alimente la catégorie du 17), `seats_default`, `doors_default`, `status`, `source`.
- `vehicle_variant` (année/finition) : `id`, `model_id`, `year_from`, `year_to`, `trim_name`, `transmission` (MT, AT, CVT, DCT), `fuel_type` (GASOLINE, DIESEL, HYBRID, PHEV, EV, LPG), `drive` (FWD, RWD, AWD, 4X4), `engine_cc`, `engine_cylinders`, `power_hp`, `consumption_l_100km` (nullable), `consumption_source`, `seats`, `doors`, `cargo_l` (nullable), `has_4x4` (dérivé), `value_class` (pour l'éligibilité, ex. HST-011), `market` (PA, PY, BOTH), `source`, `source_ref`, `license_note`, `verified_by`, `verified_at`, `status`.
- `catalog_addition_request` : `id`, `org_id`, `requested_by`, `make_text`, `model_text`, `year`, `trim_text`, `vin_masked` (optionnel), `status`, `resolved_variant_id`, `reviewed_by`.
- Côté `vehicle` (annonce de l'agence) : `variant_id` (nullable), `make_text`/`model_text` de repli uniquement si `variant_id` est nul, `year`, `trim_override`. Les filtres de recherche lisent la variante ; si elle est nulle, la fiche est exclue des filtres de caractéristiques (à décider avec le produit).
- Règles : `source` et `license_note` obligatoires sur chaque ligne ; interdire tout import dont la licence est inconnue ; les photos du catalogue sont hors MVP.

## 7. Plan d'enrichissement ultérieur (post-MVP)

1. **Phase A — mesurer** : après la bêta, calculer le taux d'annonces rattachées à une variante du catalogue et les modèles les plus demandés dans la file d'ajout ; en déduire les trous réels.
2. **Phase B — décider du payant** : demander par écrit des devis à JATO (couverture Panama et Paraguay), à un fournisseur de décodage VIN avec test sur 50 VIN réels de chaque pays, à Auto Care (VCdb, Panama) et à Teoalida (base Europe + extension). Prix : inconnus à ce jour. Critères : couverture mesurée sur la liste de test, droit de stocker après résiliation, droit d'affichage public, photos, mise à jour, coût par véhicule actif.
3. **Phase C — partenariats locaux** : accord écrit avec des concessionnaires/importateurs ou des portails d'annonces pour des fiches et photos sous licence.
4. **Phase D — qualité** : synchronisation périodique, détection de doublons, tableau de bord de couverture par marque et par pays.

## 8. Questions ouvertes (à reporter dans 22)

- Obtenir une statistique d'immatriculation par modèle (Panama, Paraguay) pour figer les ~150 modèles ; sinon utiliser les ventes de marque de 12 et 13 et l'avis des agences pilotes. À VALIDER.
- Lire les conditions de NHTSA (licence), EPA, CarQuery (reprendre quand le site fonctionnera), CarAPI, Teoalida, et les conditions d'Encuentra24 et Clasipar depuis un navigateur normal.
- Mesurer la couverture réelle de Wikidata et NHTSA sur la liste de test §1.
- Décider si un véhicule sans variante de catalogue peut être publié (exclu des filtres) au MVP.
