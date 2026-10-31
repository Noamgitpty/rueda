# 05 — Parcours locataire (Guest)

> Statut : EN COURS. Observations du 2026-10-30, navigateur intégré, **non connecté**, marché US (`/us/en`), viewport étroit (~530 px → layout mobile web). Les règles chiffrées issues de la documentation sont consolidées dans `sources/SRC_GUEST_DOCS.md` puis `08_BUSINESS_RULES.md`.

---

## G-SEARCH — Recherche de véhicules

### G-SEARCH-01 Barre de recherche (OBSERVÉ)
- Champs : **Where** (« Airport, hotel, address, city »), **From** (date + « Add time »), **Until** (date + « Add time »). En layout mobile, le champ devient « Search anywhere ».
- Onglets de mode de découverte : **All / Airports / Monthly / Nearby / Delivered / Cities**.
- Mémoire : après une recherche, la home affiche « **Continue searching for cars** » (lieu + dates de la dernière recherche) et « **Inspired by your recent searches** » (véhicules vus). Fonctionne **sans être connecté** → stockage côté navigateur (cookie/localStorage) ou ID anonyme. (OBSERVÉ)

### G-SEARCH-02 Paramètres d'URL de la recherche (OBSERVÉ)
URL normalisée par le front après une recherche « Miami, 10→13 déc. 10:00 » :
```
/us/en/search?age=30&country=US&defaultZoomLevel=11&endDate=12/13/2026&endTime=10:00
&flexibleType=NOT_FLEXIBLE&isMapSearch=false&itemsPerPage=200&latitude=25.76&longitude=-80.19
&location=Miami, FL, USA&locationType=CITY&monthlyEndDate=02/13/2027&monthlyStartDate=11/13/2026
&pickupType=ALL&placeId=<GooglePlaceId>&region=FL&searchDurationType=DAILY&sortType=RELEVANCE
&startDate=12/10/2026&startTime=10:00
```
Enseignements (INFÉRÉ à partir des noms de paramètres, à confirmer) :
| Paramètre | Signification probable | Implication produit |
|---|---|---|
| `age=30` | Âge du conducteur (défaut 30 si inconnu) | Le prix/l'éligibilité dépendent de l'âge (frais jeune conducteur, classes Deluxe 25+/Super Deluxe 30+) |
| `locationType=CITY` (+ AIRPORT, ADDRESS…) | Type de lieu | Logique différente aéroport vs ville |
| `placeId` | Google Places | Géocodage via Google Maps Platform |
| `searchDurationType=DAILY` / mensuel | Mode jour vs mois | `monthlyStartDate/EndDate` pré-calculés (+3 mois) → bascule instantanée en mode mensuel |
| `flexibleType=NOT_FLEXIBLE` | Dates flexibles | Existence probable d'une recherche à dates flexibles |
| `pickupType=ALL` | Retrait chez l'hôte / livraison | Filtre « Deliver to me » |
| `sortType=RELEVANCE` | Tri | cf. G-SEARCH-04 |
| `isMapSearch` | Recherche déclenchée par déplacement de la carte | « Search as I move the map » |
| `itemsPerPage=200` | Pagination | Jusqu'à 200 résultats, libellé « 200+ cars available » |

### G-SEARCH-03 Page de résultats (OBSERVÉ)
- En-tête : lieu + plage horaire (« Dec 10, 10:00 AM - Dec 13, 10:00 AM »), menu.
- Compteur : « **200+ cars available** — These cars are located in and around Miami. »
- **Carte Google** avec marqueurs de prix (prix total hors taxes, ex. « 131 $US »).
- **Encarts éditoriaux insérés dans la liste** (nudges) :
  - « Réservez rapidement pour éviter la hausse des prix — Les invités qui réservent moins à l'avance paient souvent plus cher et ont accès à moins d'options. » (urgence / tarification dynamique côté demande)
  - « Annulation gratuite possible (sous conditions) pour tous les voyages. » (réassurance)
  - Note : ces encarts sont affichés **en français** alors que l'interface est en anglais (`/us/en`) → la traduction suit la langue du navigateur pour certains composants. Incohérence i18n observée (opportunité UX : éviter les mélanges de langue).
- **Carte résultat** : photos (carrousel), bouton favori (« Add car to favorites »), marque/modèle, année, note (ex. 5.0) + nombre d'avis, badge **All-Star Host** éventuel, ville + **distance** (« 0.1 mi »), prix : **prix barré + « Total de X » + « Hors taxes »** (ex. « 147 $US — Total de 131 $US — Hors taxes ») → affichage d'une réduction (cause à identifier : remise durée, early bird, promo hôte).
- Fin de liste : « No more cars available — Try changing your filters, adjusting your dates, or exploring the map » (état vide/fin).
- Chat **Ask Turo** flottant.

### G-SEARCH-04 Barre de filtres rapides (OBSERVÉ)
Chips horizontales défilantes : Price range · Vehicle type · Make & model · Years · Seats · Fuel efficiency · Fuel type · Deliver to me · Self-driving · bouton **All filters**.

### G-SEARCH-05 Panneau « All filters » (OBSERVÉ — contenu intégral relevé)
| Section | Options observées | Type de contrôle |
|---|---|---|
| **Sort by** | Pertinence (défaut) · Prix : faible à élevé · Prix : élevé à faible · Distance | select |
| **Price range** | « Prix total hors taxes » Minimum $ / Maximum $ (+ histogramme de prix probable) | 2 champs numériques |
| **Vehicle type** | Voitures : Coupé, Berline, Cabriolet, Voiture à hayon · SUV : SUV compact, SUV de taille intermédiaire, Grand SUV · Minibus : Familiale, Minibus passagers, Utilitaire · Pick-ups : Pick-up, Fourgon | cases groupées (2 niveaux catégorie → sous-type) |
| **Vehicle attributes** | Make & model (select) · Years (« All years », plage) · Number of seats (4+, 5+, 6+, 7+, 8+) · Fuel efficiency (25+ MPG, 35+ MPG) · Transmission (Manual / Automatic) · Fuel type (Essence, Hybride, Électrique, Diesel) | selects + multi |
| **Features** (21) | Accessible, All-wheel drive, Android Auto, Apple CarPlay, AUX input, Backup camera, Bike rack, Blind spot warning, Bluetooth, Child seat, GPS, Heated seats, Keyless entry, Pet friendly, Self-driving, Ski rack, Snow tires, Sunroof, Toll pass, USB charger, USB input (liste repliée/dépliée « Show more/less ») | multi-cases |
| **Mileage included** | « 100mi/day and more » (curseur probable) | slider |
| **Pickup Options** | « Host brings the car to me — Show cars that can be delivered directly to an address or specific location » + champ **Enter address** | toggle + adresse |
| **Elevate your experience** | **Deluxe Class** (« Exclusive cars for guests ages 25+ ») · **Super Deluxe Class** (« Super exclusive cars for guests ages 30+ ») · **All-Star Host** (« Top-rated, experienced hosts ») | toggles |
| **Collections** (curation éditoriale, 26 observées) | Électriques branchées, Voitures de sport américaines, Abordables, Road-trip familial, Les économes, Élite électrique, Années 1990, Petites citadines, Le plein de gadgets, 4x4 robustes, Voitures de sport, V8 ou rien, Luxe ultime, Voitures manuelles, Camping motorisé tout confort, Jour de déménagement, Le raffinement allemand, Étalons italiens, Bolides de collection, Américaines vintage, Bolides récents, La Mustang à travers les années, Supercars d'exception, La fine fleur du Royaume-Uni, Au soleil même en voiture | tuiles sélectionnables |
| Pied | Bouton « **View 200+ results** » (compteur live mis à jour selon les filtres) | CTA |

Règles déduites :
- Le filtre prix porte sur le **prix total hors taxes** du séjour (pas le prix/jour). (OBSERVÉ libellé)
- Les **classes de véhicules liées à l'âge** existent : Deluxe = 25+, Super Deluxe = 30+ → règle d'éligibilité conducteur par catégorie de véhicule. (OBSERVÉ)
- Les collections sont des **listes curées / règles de segmentation** (par ex. « Années 1990 = 1990–1999 », « Étalons italiens = Ferrari, Maserati, Lamborghini ») → implémentables comme requêtes sauvegardées côté back-office. (INFÉRÉ)

→ **Pour notre plateforme** : reprendre la structure catégorie/sous-type, ajouter filtres LATAM pertinents : 4x4 / tracción, pick-up doble cabina, autorisation de sortie du territoire (Paraguay→Brésil/Argentine), aire conditionnée (évident mais à afficher), livraison aéroport (PTY, ASU), paiement en espèces/QR accepté, conducteur inclus (chofer), kilométrage illimité.

---

## G-LISTING — Fiche véhicule

Observée sur 2 fiches : **VEH-A** (SUV compact 2014, Floride centrale) et **VEH-B** (SUV compact 2022, Miami, hôte All-Star). Identifiants numériques pseudonymisés (VERIF_01). Les noms d'hôtes/locataires observés ne sont pas reproduits (données de tiers).

### G-LISTING-01 URL et titre (OBSERVÉ)
- URL : `/{pays}/{lang}/{categorie}-rental/{pays}/{ville-etat}/{marque}/{modele}/{vehicleId}?startDate=&startTime=&endDate=&endTime=` (+ `searchId=` et `searchRegion=` quand on vient de la recherche → **attribution recherche→réservation**).
- `<title>` : « {Marque} {Modèle} {Année} rental in {Ville}, {État} by {Prénom hôte} | Turo » (SEO).

### G-LISTING-02 Blocs de la fiche, dans l'ordre (OBSERVÉ, layout mobile web)
1. **Galerie** : photo principale + « View 8 photos » ; bouton favori (cœur).
2. **En-tête** : Marque Modèle ; Année + finition (« 2022 SEL ») ; note moyenne ★ + « (N trips) » cliquable ; badge **All-Star Host**.
3. **Chips caractéristiques** : nb de sièges, carburant (« Essence (ordinaire) »), consommation (MPG), boîte (Automatique).
4. **Badge prix contextuel** : « **Bonne affaire ! Prix inférieur aux options similaires pour votre voyage** » (comparaison avec les annonces similaires pour les mêmes dates).
5. **Your trip** : Trip start (date + heure) / Trip end (date + heure) — sélecteur d'heures **par pas de 30 min** (Midnight … 11:30 PM).
6. **Pickup & return location** : adresse approximative (ville + code postal, pas l'adresse exacte avant réservation) + bouton éditer (→ choix livraison).
7. **Gestion de l'indisponibilité** : si les dates chevauchent un blocage, message rouge « Cette voiture n'est pas disponible du {date heure} au {date heure} » et **toast** « End time was updated based on availability » (le front ajuste automatiquement l'heure de fin). (OBSERVÉ sur la fiche 1)
8. **Trip Savings** : « Réduction pour 3 jours ou plus — 7 $US » (remise de durée déjà appliquée et affichée).
9. **Cancellation policy** : « Annulation gratuite — Remboursement complet dans les 24 heures suivant la réservation. Options plus flexibles lors du paiement. »
10. **Options de paiement** : « Paiement flexible — Aucune avance à régler si vous choisissez l'option Remboursable lors du paiement. »
11. **Distance included** : ex. « 600 mi — $0.22/mi fee for additional miles driven » (fiche 1 : 800 mi, $0.12/mi) → **kilométrage inclus par trip** (l'hôte choisit la distance/jour, au-dessus d'un minimum imposé : 200 mi/j standard, 100 Deluxe, 75 Super Deluxe — DOCUMENTÉ SRC_GUEST_DOCS) ; **le prix du mile supplémentaire est calculé par Turo = prix journalier ÷ distance journalière incluse** (DOCUMENTÉ ; corrigé suite à VERIF_01-V02 — l'hypothèse initiale « fixé par l'hôte » était fausse).
12. **Insurance & Protection** : « Insurance via Travelers » + « Learn more about insurance ».
13. Liens : Add to favorites · **Report listing** (signalement) · Cancellation policy.
14. **Vehicle features** groupées par catégorie : Sécurité (régulateur adaptatif, AWD, caméra de recul, angles morts, assistance freinage, sortie de voie, maintien de voie) · Connectivité (Android Auto, CarPlay, AUX, Bluetooth, USB charger/input) · Commodité (GPS, **Carte de péage**) · Autres (sièges enfants, sièges chauffants, toit ouvrant) ; « See all 18 features » ; mention légale marques Apple/Google.
15. **Included with your trip** (promesse plateforme, identique sur les 2 fiches) :
    - Skip the rental counter — instructions de retrait/retour via l'app
    - **Add drivers anytime after booking**
    - **2-hour pickup window** — pas besoin de modifier le trip sauf retard > 2 h
    - No car wash necessary, but keep the vehicle tidy
    - Free 24/7 roadside assistance ; 24/7 customer support
16. **Extras (N)** : « Add optional Extras to your trip at checkout » ; chaque extra = nom, description libre de l'hôte, **prix par trip**, **quantité disponible** (« 1 available », « 2 available »). Exemples : Unlimited distance 150 $/trip ; Prepaid refuel 50 $/trip (« return at any fuel level, includes up to a full tank ») ; Child safety seat 25–40 $/trip. Un même type d'extra peut apparaître plusieurs fois (2 sièges distincts).
17. **Reviews** : note moyenne + nombre de ratings, extraits (texte + prénom + date), **réponse publique de l'hôte** sous l'avis ; avis multilingues (EN/ES) ; « See more ».
18. **Hosted by** : note hôte, badge All-Star (« Turo's highest-rated hosts »), nb de trips, ancienneté (« 9 years of hosting »).
19. **Rules of the road** (règles plateforme) : No smoking (amende 150 $) ; Keep the vehicle tidy (150 $ si déraisonnablement sale) ; Refuel the vehicle (frais si carburant manquant) ; No off-roading ; mention **télématique** : « Vehicle may have a device that collects driving and location data… shared with third parties for vehicle recovery or protection ».
20. **Barre sticky** : prix barré + « Total de 144 $US — Hors taxes » + CTA **Continue**.
21. **Similar cars for your dates** (carrousel même modèle/similaires, total du séjour) ; « Browse more {modèle} vehicles » ; liens SEO.

---

## G-BOOK — Checkout (`/us/en/turbo-book`) — OBSERVÉ (non connecté, aucune réservation effectuée)

URL : `/us/en/turbo-book?vehicleId=<VEH-B>&startDate=01/14/2027&startTime=10:00&endDate=01/17/2027&endTime=10:00&reservationLocationType=HOME`
→ `reservationLocationType=HOME` = retrait au domicile/lieu de l'hôte (autres valeurs probables : DELIVERY, AIRPORT — INFÉRÉ).

### G-BOOK-01 Structure de la page (une seule page, sections empilées)
1. Récap véhicule (modèle, année, note, nb trips), dates/heures, lieu.
2. **Primary driver** (checkout invité **sans compte préalable** — bouton « Log in » à droite) :
   - First name (« First name on license » — « Preferred name can be added later »)
   - Last name (« Last name on license »)
   - Country code + Mobile number — **pré-sélection PA +507 et placeholder « 6123-4567 »** (format panaméen) → indicatif pays déduit de la géolocalisation IP de l'utilisateur. Consentement : « By providing a phone number, you consent to receive automated text messages with trip or account updates. »
   - Email
   - **Age** (liste 18 → 55+) — obligatoire pour afficher les protections.
   - Bandeau : « Une fois la réservation terminée, vous devrez fournir plus d'informations afin d'éviter l'annulation de votre voyage, ainsi que des frais. » → **vérification conducteur post-réservation** (permis, etc.) avec risque d'annulation + frais.
   - « Add additional drivers after booking. »
3. **Protection plans** (« Select your age to see options » avant saisie de l'âge) — voir 10_INSURANCE.
4. **Extras** : « Customize your trip — Choose from: … » + Add.
5. **Booking rate** (choix tarifaire = politique d'annulation) :
   - **Non remboursable** : 156,95 $ — « Annulation gratuite pendant 24 heures. Passé ce délai, le voyage ne pourra pas être remboursé. Économisez 15 $US. Offre limitée dans le temps »
   - **Remboursable** : 172,41 $ — « Annulation gratuite jusqu'au 13 janv. (veille du départ). Facilités de paiement disponibles, sans aucune avance à faire. »
   - Écart observé : +15,46 $ (+9,85 %) pour le remboursable. Règle documentée (SRC_GUEST_DOCS/SRC_HOST_DOCS) : **remise fixe de 10 % pour un tarif non remboursable réservé ≥ 4 jours avant le départ**. Le détail du sous-total (tarif non remboursable par défaut) ne montrait **aucune ligne de remise** → à re-tester en ouvrant le détail sur les deux tarifs (VERIF_01-V05, OUVERT).
6. **Summary** : Sous-total (cliquable → détail), TVA/taxes, Distance incluse + prix du mile sup., **Montant total du voyage**, « **Ajouter un code promo** ».
7. **Choose when to pay** : « Régler maintenant » / « **Payer en plusieurs fois** » (« Vous choisirez un fournisseur de services de paiement avant de réserver ») → BNPL (Affirm/Klarna-like — fournisseur NON IDENTIFIÉ).
8. **Payment** + consentement : « J'accepte de payer le montant total affiché, ainsi que les Conditions de service de Turo, les Conditions d'annulation et l'avis de confidentialité ».
9. Barre sticky : « Total de X — Taxes et frais inclus » + **Book trip**.

### G-BOOK-02 Décomposition tarifaire mesurée (DIRECTEMENT TESTÉ sur l'écran, sans réserver)
Trip de 3 jours, 14→17 janv. 2027, SUV 2022 Miami, tarif non remboursable, sans protection ni extra :
| Ligne | Montant | Remarque |
|---|---|---|
| 3 jours | 123,08 $ | ≈ 41,03 $/jour (prix hôte) |
| Réduction pour 3 jours ou plus | −6,80 $ | ≈ 5,5 % (remise durée définie par l'hôte — INFÉRÉ) |
| **Frais de voyage** (Trip fee) | 27,40 $ | « couvrent les services de la plateforme, notamment le Service Clients 24/7 » ≈ 23,6 % du net (116,28 $) |
| = Sous-total | 143,68 $ | |
| Taxes (« TVA ») | 13,27 $ | |
| = Total | 156,95 $ | |

**Frais jeune conducteur** (âge saisi au checkout, même trip) :
| Âge | Sous-total | Taxes | Écart |
|---|---|---|---|
| 18–20 | 293,68 $ | 23,77 $ | **+150 $ (= 50 $/jour)** |
| 21–24 | 203,68 $ | 17,47 $ | **+60 $ (= 20 $/jour)** |
| 25+ (testé 25, 30) | 143,68 $ | 13,27 $ | 0 |
→ Les seuils 21 et 25 ans sont confirmés par test. **Attention (VERIF_01-V08)** : 50 $/20 $ par jour est une observation unique sur un trip de 3 jours ; Turo indique que le montant **varie selon la durée** (barème non publié) → table paramétrable, pas une constante. L'âge minimum de réservation affiché par le sélecteur est 18 ans (US). Les montants exacts/jour et plafonds éventuels : à confirmer dans la doc (cf. SRC_GUEST_DOCS).
→ **Taxes (corrigé VERIF_01-V04, recalcul vérifié au centime)** : taxes = 7 % × (sous-total complet **trip fee compris** + surtaxe P2P Floride 1 $/jour) + la surtaxe elle-même (1 $/jour, Fla. Stat. 212.0606(3) — DOCUMENTÉ-SECONDAIRE via auditeur). Vérification : (143,68 + 3) × 7 % + 3 = 13,27 ✓ ; (203,68 + 3) × 7 % + 3 = 17,47 ✓ ; (293,68 + 3) × 7 % + 3 = 23,77 ✓. L'inférence initiale (« trip fee non taxé + composante fixe 5,13 $ ») est retirée.
→ Les tarifs des protections sont **identiques** à 22 et 30 ans sur ce véhicule (OBSERVÉ).

### G-BOOK-03 Sélecteur d'extras (OBSERVÉ)
Panneau « Trip add-ons offered by your host » groupé par catégorie (« Commodité ») ; par extra : nom, prix/trip, description de l'hôte, stock (« 1 available »), **stepper quantité** (− 0 +) borné par le stock ; option « I don't want any extras ».

### G-BOOK-04 Paiement en plusieurs fois (OBSERVÉ)
En choisissant « Payer en plusieurs fois » : section Payment devient « **A card on file will be required before the trip starts** » ; le CTA passe de « Book trip » à « **Continue** » (étape suivante = choix du fournisseur BNPL puis « Réserver ce voyage »). → Même en BNPL, une **carte enregistrée est exigée** (garantie pour frais post-trip/dommages).

### G-BOOK-05 Code promo (OBSERVÉ partiellement)
Lien « Ajouter un code promo » dans le Summary ; le clic n'a pas ouvert de modale détectable en non connecté → à retester connecté.

## À compléter
- G-LISTING : ouvrir les modales (photos, cancellation policy, insurance, report listing, edit location/livraison)
- G-BOOK (checkout) — à explorer jusqu'à la page paiement sans valider
- G-ACCOUNT (compte connecté) — en attente de connexion

## G-HOW — « How Turo works » (DOCUMENTÉ — https://turo.com/us/en/car-rental/united-states/how-turo-works)
- Retrait dans parkings/garages de **100+ aéroports US/Canada** ; certains petits aéroports autorisent le **retrait au trottoir (curbside)** ; règles aéroportuaires variables (« check the app »).
- Parcours en 3 étapes : trouver → choisir un lieu (proche ou **livré** : aéroports, gares, hôtels, domicile) → l'hôte envoie les instructions de retrait.
- À chaque location : instructions de retrait/retour après réservation ; **check-in / check-out et chat dans l'app** ; **téléverser le permis** ou le montrer à l'hôte en personne.
- **3 modes de remise des clés** : en personne ; **boîte à clés (lockbox)** avec code envoyé par l'hôte ; **déverrouillage à distance via l'app du constructeur**.
- Protection : Premier (« eligibility requirements apply »), Standard, Minimum. RC incluse **secondaire (excess)** jusqu'aux minima de l'État pour tout « **Turo-approved driver** », sauf États exigeant une couverture primaire (Maryland, New York). L'assurance perso du guest intervient **avant** le plan de protection (sauf cas limités dans le Maryland).
- Argumentaire vs loueur : 1 600+ marques/modèles, « exact car », livraison, véhicules notés.
- FAQ listées : disponibilité, prérequis pour réserver, assurance perso, autres conducteurs, annulation, urgence, livraison, réductions.


---

## G-ACCOUNT — Espace connecté (OBSERVÉ 2026-10-30, compte réel de l'utilisateur, lecture seule ; aucune donnée personnelle reproduite)

### G-ACCOUNT-01 Menu utilisateur connecté (compte guest sans véhicule)
Favorites · Trips · Inbox — Profile · Account · Earn on Turo — Why choose Turo · Gift cards · Get help · Legal — Log out. Avatar photo dans le header. Aucun menu hôte tant que l'utilisateur n'a pas d'annonce (INFÉRÉ : le menu hôte « Vehicles / Calendar / Earnings / Performance… » apparaît après création d'annonce — à confirmer).
URLs : `/us/en/trips`, `/us/en/inbox` (→ `/inbox/messages`), `/us/en/drivers/{userId}` (profil public), `/us/en/drivers/{userId}/favorites`, `/us/en/account`, `/logout`.

### G-ACCOUNT-02 Page Account `/us/en/account` (sections dans l'ordre)
1. **Personal information**
   - PREFERRED FIRST NAME + Update — texte d'aide paraphrasé : choisir le nom d'usage affiché sur Turo ; **un hôte peut y afficher son nom commercial aux guests** (citation raccourcie, A24-21)
   - DRIVER'S LICENSE : nom figurant sur le permis + **View** (le permis vérifié est stocké et consultable).
   - Email : badge **Verified**.
   - MOBILE PHONE : badge **Verified** + Update.
   - PASSWORD : Update.
   - **Link to your Google account** (liaison SSO a posteriori). Bouton Save changes.
2. **Notification settings**
   - **Language** (9 locales : en-US, en-AU, en-CA, en-GB, **es-US**, fr-CA, fr-FR, **pt-BR**) → l'espagnol existe (US) et le portugais du Brésil (indice d'ambition LATAM ? — INFÉRÉ).
   - Matrice **catégorie × canal (Email / SMS)** :
     | Catégorie | Email | SMS |
     |---|---|---|
     | Voyage et compte (trips, réservations, activité du compte) | **Required** (non désactivable) | optionnel |
     | Messages des hôtes et des invités | ✓ | ✓ |
     | Recommandations personnalisées | ✓ | ✓ |
     | Offres (réductions, promos saisonnières) | ✓ | ✓ |
     | Actualités et mises à jour (nouvelles fonctionnalités, communauté) | ✓ | ✓ |
     (Push mobile non visible sur le web → probablement géré dans l'app.)
3. **Transmission** : « Some cars on Turo do not have automatic transmissions. Are you an expert at driving manual transmissions? » → Yes / No (+ Save) → **qualification déclarative pour réserver un véhicule manuel**.
4. **Approval status** : « You are approved » (statut d'approbation conducteur = état de compte).
5. **Payment method** + Update.
6. **Travel credit** : champ TRAVEL CREDIT CODE + Apply ; « Travel credit will automatically apply towards your next trip. Promo codes must be entered at checkout. » ; **Balance: $0** → distinction **crédit voyage (portefeuille, auto-appliqué)** vs **code promo (au checkout)**.
7. **Download account data** : « download a copy of all information Turo has accumulated… as often as you'd like » → **portabilité RGPD/CCPA en self-service**.
8. **Close account** : « Close my account » (non cliqué — action irréversible).

### G-TRIPS-01 Trips `/us/en/trips` (et `/trips/history`)
État vide : « No upcoming trips yet — Explore thousands of cars… — Start searching ». Lien « **Pitch a trip** » (fonctionnalité à documenter). `/trips/history` renvoie le même état vide (onglets non visibles sans trip).

### G-INBOX-01 Inbox — 2 onglets : **MESSAGES** (`/inbox/messages`, état vide « No messages ») et **NOTIFICATIONS** (`/inbox/notifications`, flux « ACTIVITY »).
Exemple de notification réelle observée (anonymisée) :
> Paraphrase (A24-21) : le message annonce que l'utilisateur est désormais **conducteur additionnel** du trip de {Prénom} ({véhicule}, jusqu'au 07/19/2026), couvert par la protection du trip à partir de {heure} EDT, et que **le titulaire doit être présent à la remise et au retour** ; extrait : « {Prénom} must be present for pickup and return » + horodatage.
Enseignements :
- **Conducteur additionnel** = un compte Turo distinct, approuvé, rattaché au trip d'un autre ; il est notifié quand il est ajouté ; **couvert par la protection du trip à partir d'une heure précise** ; **le primary guest doit être présent au retrait et au retour** (règle métier — OBSERVÉ).
- **Bug de template observé** : la notification contient un placeholder non résolu `{6}` et un champ mal substitué (nom à la place du lieu) → leçon pour nous : tests automatisés des gabarits de notification avec toutes les variables (critère d'acceptation).

### G-FAV-01 Favorites `/us/en/drivers/{userId}/favorites`
Titre « {Prénom}'s favorites » ; favoris organisés en **listes nommées** (ex. « {Ville} {date} — 1 vehicle ») → le cœur « Add car to favorites » ajoute à une **liste/collection** (wishlist type Airbnb). Page sous l'URL du profil (visibilité publique possible ? — à vérifier).

### G-PROFILE-01 Profil public `/us/en/drivers/{userId}` (OBSERVÉ, données non reproduites)
- Bouton **Edit profile** (propriétaire du profil uniquement) ; prénom préféré ; **« Joined {mois année} »** ; photo.
- **VERIFIED INFO** : Email address, Phone number (badges) + « Build trust with other users on Turo by verifying your contact information. »
- **REVIEWS FROM HOSTS** (avis reçus en tant que guest) ; état vide « {Prénom} hasn't received a review on Turo yet. »
- Le profil public d'un guest est visible par les hôtes (prise de décision sur les demandes). Champs d'édition (bio, langues, travail, école… ?) : à relever via Edit profile.

### G-BOOK-06 Retest connecté du checkout — tarifs remboursable vs non remboursable (DIRECTEMENT TESTÉ 2026-10-30, VEH-B, 14→17 janv. 2027, aucune réservation) — résout VERIF_01-V05
| Ligne | Non remboursable | Remboursable |
|---|---|---|
| 3 jours (ligne de base) | 123,08 $ | 136,00 $ (45,33 $/j) |
| Remise 3+ jours | −6,80 $ | −6,80 $ |
| Net location | **116,28 $** | **129,20 $** |
| Trip fee | 27,40 $ (23,56 % du net) | 28,93 $ (22,39 % du net) |
| Sous-total | 143,68 $ | 158,13 $ |
| Sales tax | 13,27 $ | 14,28 $ |
| **Total** | **156,95 $** | **172,41 $** |
Constats :
- **La remise non remboursable n'est pas une ligne** : elle est intégrée dans la ligne « N jours ». Valeur : **10 % du net après remise de durée** — 129,20 × 0,90 = 116,28 ✓ (au centime). Le libellé commercial « Save $15 » = écart de total TTC (172,41 − 156,95 = 15,46).
- **Trip fee non proportionnel** : 23,56 % vs 22,39 % → formule non linéaire (paliers, plafond ou dépendance au risque/« Turo Risk Score » cité dans le S-1) — INFÉRÉ, formule exacte inconnue.
- Taxes : (158,13 + 3) × 7 % + 3 = 14,28 ✓ → formule VERIF_01-V04 confirmée sur un 2e point.
- **Connecté, 3 options de paiement** (vs 2 en invité) : **Pay now** · **Pay later** (« Trip total will be automatically charged to your payment method on Thu, Jan 7. No additional cost. » = **J−7** pour un départ le 14) · **Pay over time** (choix d'un fournisseur BNPL avant réservation).
- Case **opt-in marketing** au checkout (« Send me email updates… ») + consentement CGU/annulation/confidentialité.
- Interface en anglais une fois connecté (préférence de langue du compte = en-US) alors qu'elle mélangeait FR/EN non connecté.
