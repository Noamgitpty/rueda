# 06 — Parcours propriétaire (Host)

> Statut : EN COURS. Observations du 2026-10-30, non connecté, marché US. Les règles chiffrées documentées seront consolidées depuis `sources/SRC_HOST_DOCS.md`.

## H-ACQ — Page d'acquisition hôte `/us/en/car-rental/united-states/list-your-car` (OBSERVÉ)

Structure de la landing (ordre) :
1. Hero « Rent out your car and earn money on Turo » + promesse « Hosts across the US earn **$10,489 per year per car on average*** » + logo partenaire assurance + CTA **Get started** (→ `/us/en/list-your-car/list`).
2. Preuves sociales chiffrées (au 31/10/2025, 12 derniers mois) : **$6.6B** de revenus hôtes cumulés, **3.6M+** guests actifs, **340 000+** véhicules actifs, **28 000+** villes ; « the world's largest car sharing marketplace ».
3. Conseils : Grow at your own pace · Offer an excellent guest experience (→ All-Star Host) · **Offer airport delivery** (« Nearly a third of trips on Turo start at the airport ») · **Attract monthly trips** (« the fastest-growing type of trip on Turo »).
4. Simulateur de revenus statique : **$10,489/an/voiture**, **$874/mois**, **15 jours réservés/mois** en moyenne (US, année 2025) ; 1 voiture $10,489 · 3 voitures $31,467 · 5 voitures $52,445 (incitation multi-véhicules).
5. **You're protected** : jusqu'à **$750 000** de responsabilité civile tiers (Travelers) + **trois « earnings plans »** avec différents niveaux de remboursement des réparations jusqu'à la **valeur réelle (actual cash value)** du véhicule.
6. How Turo helps hosts : app de gestion (trips, prix, messages), Safety & support (support 24/7, assistance routière guests, **business coaching** pour hôtes ambitieux), Demand generation (marketing financé par Turo).
7. Témoignages d'hôtes ; vidéo « Why hosts love monthly trips ».
8. FAQ : Can I rent out my car? · How much can I make? · Is it worth it? · What do I need? · **Can I rent out my financed car?** · **Can I rent out my leased car?**
9. Avertissement réglementaire : **Californie et Oregon** ont une législation sur l'autopartage P2P limitant les revenus dans certains cas.

Mentions légales importantes (DOCUMENTÉ — texte de la page) :
- Responsabilité civile : police Travelers Excess and Surplus Lines Company ; jusqu'à $750 000 pour tous les plans hôte, sauf certains États/aéroports ; **New York : minimum légal** de l'État, avec option « More Peace of Mind » à $300 000 ; **Turo Insurance Agency** (agence d'assurance filiale) pour certains États.
- **« Turo is not an insurance company »** : le remboursement des dommages physiques est **contractuel, pas une assurance**. Turo rembourse les dommages éligibles au-delà de la **« per trip damage responsibility »** de l'hôte, plafonné au **moindre de : coût de réparation jusqu'à l'ACV du véhicule, ou $200 000**. Exception **État de Washington** : dommages physiques couverts par une assurance achetée par Turo.
→ **Enseignement clé pour LATAM** : le montage juridique « garantie contractuelle de la plateforme + RC via assureur partenaire » est central. Il faudra vérifier au Panama/Paraguay si un tel « remboursement contractuel » est assimilable à de l'assurance (activité réglementée) → question pour avocat (voir 22_OPEN_QUESTIONS).

## H-ONB — Entrée dans le flux de mise en location (OBSERVÉ)
- `Get started` → `/us/en/list-your-car/list` → **redirection vers l'inscription si non connecté** : `/us/en/sign-up?next=/us/en/list-your-car/list` (paramètre `next` = deep-link de retour).
- Le flux de création d'annonce lui-même : **BLOQUÉ (connexion requise)** — à explorer une fois l'utilisateur connecté, sans publier.

## Inscription (OBSERVÉ) — commune guest/host
Écran « Welcome to Turo — Create an account to get started » : **Continue with Apple · Continue with Google · Continue with email** ; « Already have an account? Log in » ; « By logging in, you agree to Turo Inc.'s terms of service and privacy policy ».
Formulaire email (`/sign-up/email`) :
| Champ | Remarque |
|---|---|
| First name on driver's license | « You can add a preferred name through your Account later » |
| Last name on driver's license | nom légal = nom du permis (cohérence vérification) |
| Email | |
| Password | |
| ☐ Send me email updates, recommendations, and deals | opt-in marketing **non pré-coché** |
| ☐ I agree to the terms of service and privacy policy | consentement explicite obligatoire |
| Bouton Sign up | |
→ Pas de téléphone ni date de naissance à l'inscription : collectés plus tard (checkout / vérification). Rien n'a été soumis.

## H-TOOLS-01 — Carculator® (simulateur de revenus) (DIRECTEMENT TESTÉ, 2026-10-30)
- Page hôte `/host-hub/resources/carculator` qui embarque un **iframe** `https://resources.turo.com/carculator/index.html?country=US&hostPath=/us/en` (micro-app séparée, paramétrée par pays).
- Étape 1 « Where's your car located? » : select **Market** = 20 grandes zones US (Atlanta, Boston, Chicago, Dallas–Fort Worth, Denver, Detroit, Honolulu, Houston, Las Vegas, Los Angeles, Miami, New York, Orlando, Philadelphia, Phoenix, San Diego, SF Bay Area, Seattle, Tampa, Washington DC) — zones ≈ DMA Nielsen.
- Étape 2 « What car do you have? » : bascule **Specific car / Category** ; selects **Make** (≈55 marques, dont Can-Am, Polaris, Vanderhall → véhicules de loisir), **Model**, **Year** (2020–2026 uniquement).
- Résultat : « Your {année} {marque} {modèle} could earn » → **Earnings per month**, **Earnings per year**, **Days booked per month** ; **slider « Days booked per month »** 1–30 (défaut 21) recalculant les revenus.
- Classement « Top-earning {catégorie} similar to yours in {market} » (top 10 avec revenus mensuels/annuels, cliquables).
- Méthodologie publiée : moyenne des revenus réels des véhicules US de TMV > $10 000, années ≥ 2020, dans les zones ayant ≥ 5 véhicules actifs distincts, période 08/2025–08/2026.
- **Pour notre plateforme (PROPOSÉ)** : simulateur indispensable à l'acquisition d'hôtes ; au lancement (sans données), l'alimenter avec des prix de marché des loueurs (benchmark) + hypothèse d'occupation, puis basculer sur nos données réelles. Marchés = Ciudad de Panamá, Colón, David, Panamá Oeste ; Gran Asunción, Ciudad del Este, Encarnación.

## H-HUB — Host Hub (OBSERVÉ, navigation)
Sections : HOME · UPDATES · RESOURCES → Host services · Deals & discounts (partenariats hôtes) · Airport delivery · Monthly trips · Hosting 101 · Grow your business · Carculator. (Contenus à parcourir.)

## H-PERF-01 — Programme All-Star Host (DOCUMENTÉ — https://turo.com/us/en/car-rental/united-states/all-star-host, 2026-10-30)
- **Évaluation trimestrielle** (mi-janvier, avril, juillet, octobre) sur les **365 derniers jours** → statut valable pour le cycle suivant.
- Critères (tous requis) :
  | Critère | Seuil |
  |---|---|
  | Taux de notes 5 étoiles global | **≥ 85 %** |
  | Taux d'annulation hôte | **≤ 3 %** des trips réservés |
  | Taux de notes 5★ « maintenance » | **≥ 80 %** |
  | Taux de notes 5★ « cleanliness » (propreté) | **≥ 80 %** |
  | Volume | **≥ 20 trips complétés** OU **80 jours de trip sur ≥ 5 trips** |
  → Implique que l'avis guest comporte des **sous-notes** (au moins : globale, maintenance, propreté).
- Avantages : badge sur annonce + profil ; **filtre de recherche « All-Star Host »** ; **promo code $100/an** pour louer soi-même (converti en devise locale hors US) ; **priorisation** quand Turo aide un guest à réserver (ranking / rebooking).
- Bouton « Check your performance » (tableau de bord performance hôte — connecté).
- Niveau supérieur : **Power Host** (« most dependable, ambitious, accomplished hosts ») — All-Star est un prérequis. (Critères à documenter.)

## H-MONTHLY — Trips mensuels (DOCUMENTÉ — https://turo.com/us/en/car-rental/united-states/host-hub/resources/monthly-trips)
- « Fastest-growing type of booking ». Chiffres Turo : 40 % des véhicules gagneraient plus avec un trip mensuel ; **−61 % de miles/jour** ; **−68 % de sinistres** vs trips courts.
- **Remise mensuelle « optimisée » = 45 %** → débloque automatiquement une **limite de distance réduite de 1 800 miles/mois** (page Host Hub). **Correction VERIF_01-V03** : selon le centre d'aide, 1 800 mi/mois ne vaut que pour **Deluxe/Super Deluxe** ; véhicule standard : minimum mensuel **3 300 mi** → la règle du help center prévaut ; contradiction consignée dans 22_OPEN_QUESTIONS.
- **Maintenance pendant un trip ≥ 30 jours** : l'hôte peut demander au guest de faire l'entretien courant ; le guest a **2 semaines** pour amener la voiture au garage ; **coût payé par l'hôte**.
- Dépassement de distance : facturable comme pour les trips courts.
- Le véhicule reste réservable pour des trips courts.
- **Paiements partiels hebdomadaires** à l'hôte pour tout trip **> 7 jours** (pas d'attente de la fin du trip).
- Recherche guest : mode « Monthly » avec prix /mois (cf. home et `monthlyStartDate`).

## H-AIRPORT — Livraison aéroport (DOCUMENTÉ — https://turo.com/us/en/car-rental/united-states/host-hub/resources/airport-delivery)
- ≈ 1/3 des trips commencent et finissent à un aéroport. Données Turo (nov. 2024→nov. 2025) : **+21 % de revenus/trip**, **−34 % de miles/jour**, **−33 % de taux de sinistres** vs hors aéroport.
- **Turo détient des permis dans 170+ aéroports US/Canada** ; chaque aéroport a ses règles (zones de stationnement autorisées, curbside ou non, frais).
- **Frais d'accès aéroport** fixés par l'aéroport, non majorés, **généralement payés par le guest** ; certains exigent aussi le **parking standard** (à annoncer au guest à l'avance).
- **Frais de livraison aéroport fixés par l'hôte, plafonnés par aéroport** ; l'hôte touche **90 % des frais de livraison** pour les trips aéroport selon la page Host Hub. **CONTRADICTION (VERIF_01-V07)** : le centre d'aide US applique la **part du plan (70/80/90 %)** à la livraison et aux Extras ; le 90 % fixe n'est documenté que pour l'Australie et le Royaume-Uni → règle non fiable. **Précision VERIF_03-F02** : changement daté — pour les trips réservés **depuis le 08/10/2026**, hôtes US et CA = part du plan sur livraison et Extras ; la page Host Hub est donc **périmée**. Le prix affiché en recherche **inclut la livraison** (« all-in pricing »).
- Configuration : paramètres « **Location & delivery** » → activer aéroport + fixer le prix → renseigner **l'emplacement exact** (niveau, rangée, **photo**).
- **Guidage in-app** du guest du terminal jusqu'à la voiture et vers le parking de retour (grands aéroports).
- Aéroport sans permis → point de rencontre hors emprise aéroportuaire ; formulaire de demande de permis (priorisation selon la demande).
- Interdit : nettoyer la voiture sur l'emprise de l'aéroport ; livrer hors zones approuvées → amendes/interdiction.
→ **Pour LATAM (PROPOSÉ)** : PTY (Tocumen) et ASU (Silvio Pettirossi) = cas d'usage n°1 ; négocier un permis/partenariat parking aéroport est un chantier opérationnel P0/P1 ; modéliser l'entité `AirportPermit` (règles, zones, frais, plafond de livraison).

## H-GROW — Grow your business (OBSERVÉ)
Articles (« Add a pickup location for seamless airport trips », « Lower monthly discounts to help boost host earnings » (03/2025), « Get the most out of your calendar ») + outils : **Carculator**, **Turo business planner**, **Top-earning cars on Turo**.

## H-ONB-02 — Flux « List your car » connecté (DIRECTEMENT TESTÉ jusqu'à l'étape VIN, 2026-10-30, aucune publication)
URL unique : `/us/en/list-your-car/list` (wizard mono-URL, état côté client/serveur).

### Pré-étape « Location » (avant le wizard)
- Titre « Location » puis question « Where is your car located? », avec une phrase expliquant que Turo vérifie qu'il opère à l'adresse indiquée (paraphrase, A24-21) ; champ adresse **Google Places** (« powered by Google ») ; suggestions typées par icône (aéroport ✈, lieu, bâtiment) ; option « **I don't see my address** ».
- **Autocomplete restreint aux pays opérés** : « Panama City, Panama » ne propose que Panama City (Floride).
- « I don't see my address » → formulaire manuel **Address** : Country (liste mondiale ~250 pays, dont PA et PY), Street address, City, State/Region/Province, Zip/Postal code ; bouton Next activé seulement quand tout est rempli.
- Puis écran **Car location** : « Guests will pick up your car here. » et une invite à ajuster l'épingle si la position est inexacte (paraphrase, A24-21) + carte + **Adjust pin** + **Confirm location** / Back.
- **Blocage pays non opéré (DIRECTEMENT TESTÉ)** : adresse au Panama → message « **Unfortunately, Turo hasn't launched car sharing in your country yet.** » ; Next désactivé. → Confirme que Turo n'accepte aucun hôte au Panama (EV-0013).
- Adresse US (MIA, adresse publique d'aéroport) → accès au wizard.

### Wizard — 9 étapes (OBSERVÉ via « View all steps »)
En-tête : « 1 of 9 steps | Next: {étape suivante} | **Start over** | **View all steps** ».
1. **Your car** (VIN, puis détails déduits)
2. **Your goals** (objectifs de l'hôte — probablement revenus / usage / nombre de jours — à documenter)
3. **Monthly trips** (opt-in trips mensuels / remise)
4. **Car availability**
5. **Vehicle details**
6. **Car photos**
7. **Payout** (coordonnées de versement)
8. **Safety & quality standards** (engagements)
9. **Submit your listing**

### Étape 1 — VIN (OBSERVÉ)
- « We'll use your Vehicle Identification Number (VIN) to identify your specific car » ; champ « Enter 17 digit VIN » ; case **« My vehicle is older than 1981 »** (VIN non standard avant 1981 → saisie manuelle probable).
- Aide « Where can I find it? » : 17 caractères ; emplacements : montant de portière conducteur, bas du pare-brise côté conducteur, documents (titre, carte grise, assurance).
- **Arrêt volontaire** : aller plus loin exigerait un VIN réel ; en saisir un faux contreviendrait aux CGU (fausses informations). Étapes 1→9 : à documenter via le centre d'aide (agent hôte) ou avec un VIN réel fourni par l'utilisateur (sans soumettre l'étape 9).
→ [NOUS] Au Panama/Paraguay, le VIN est présent sur la plupart des véhicules mais l'identifiant administratif usuel est la **plaque** + le **registro único vehicular / cédula del vehículo** ; prévoir décodage VIN (marque/modèle/année) + saisie manuelle + contrôle de la carte grise par OCR.
