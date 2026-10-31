# 03 — Sitemap et navigation de Turo

> Statut global : EN COURS. Sauf mention contraire, éléments OBSERVÉS le 2026-10-30 sur https://turo.com/us/en (non connecté).

## 1. Structure d'URL (OBSERVÉ)
Schéma : `https://turo.com/{pays}/{langue}/...`
- Pays/langues observés dans le footer : `us/en`, `au/en`, `ca/en`, `ca/fr`, `fr/fr`, `gb/en`.
- Centre d'aide hors locale : `https://turo.com/help`.
- Politiques : `https://turo.com/us/en/policies/terms`, `/policies/privacy`, `https://turo.com/policies/additional-policies#cookies`.
- Blog : `https://turo.com/blog/`. Communauté hôtes : `https://openroad.turo.com/`.

### Pages SEO de catalogue (OBSERVÉ)
| Gabarit | Exemple |
|---|---|
| Catégorie × pays | `/us/en/{categorie}-rental/united-states` (car, minivan, exotic-luxury, truck, van, cargo-van, box-truck, classic, sports, suv, convertible, electric-vehicle) |
| Catégorie × ville | `/us/en/truck-rental/united-states/atlanta-ga` |
| Marque | `/us/en/car-rental/united-states/bmw` ; index `/makes` |
| Modèle | `/us/en/suv-rental/united-states/models/jeep-wrangler` |
| Ville | `/us/en/car-rental/united-states/honolulu-hi` |
| Aéroport (code IATA) | `/us/en/car-rental/united-states/lax` ; index `/airports` |
| État | `/us/en/car-rental/united-states/states/texas` |
| Ville internationale | `/us/en/car-rental/france/paris-75`, `/australia/sydney`, `/canada/montreal-qc`, `/united-kingdom/london` |
| **Fiche véhicule** | `/us/en/{categorie}-rental/{pays}/{ville-etat}/{marque}/{modele}/{vehicleId}` (ID numérique, ex. 3707221) |

→ Enseignement produit : l'URL de fiche véhicule encode catégorie + localisation + marque + modèle (SEO long tail) et l'ID numérique est la seule clé réelle. À reproduire (slug en espagnol pour LATAM : `/pa/es/alquiler-de-autos/panama/ciudad-de-panama/toyota/hilux/123`).

## 2. Header (non connecté) (OBSERVÉ)
- Logo → `/`
- Bannière promo hôte : « Earn up to $1,000 per month sharing your car on Turo » → `/car-rental/united-states/list-your-car`
- Barre de recherche : **Where** (placeholder « Airport, hotel, address, city »), **From** (date + « Add time »), **Until** (date + « Add time »), bouton **Search**
- Liens : **Earn on Turo**, **Ask Turo** (assistant conversationnel), **Menu**
- Menu (liens détectés) : Log in, Sign up, Why choose Turo, Gift cards, Get help, Legal, Insurance & protection, Host Hub, Carculator

## 3. Page d'accueil (OBSERVÉ)
- Onglets de découverte sous la recherche : **All / Airports / Monthly / Nearby / Delivered / Cities**
- Carrousels thématiques (prix moyen par jour pour un trip de 3 jours + total) : aéroport (HNL), mensuel (Dallas, prix /month), luxe (SFO), Tesla FSD (Las Vegas, page dédiée `/tesla/fsd-rental`), marque (BMW à ATL), mensuel récent (Atlanta), trucks (LAX), SUV (MCO), SUV Denver, ville (Orlando).
- Carte véhicule : photo, bouton favori (« Add car to favorites »), marque modèle, année, note moyenne + nombre d'avis OU badge « New listing », prix/jour et total (ou prix/mois pour l'onglet Monthly).
- Bloc « Rent a Tesla with Full Self-Driving (Supervised) » (partenariat/segment).
- Bloc SEO à onglets : VEHICLE TYPES / MAKES & MODELS / US CITIES / AIRPORTS / INTERNATIONAL CITIES / STATES.
- Chat « Ask Turo » (boutons Restart chat / Close chat).
- Bannière cookies (Politique de cookies) + lien « Cookie preferences » + « Do not sell or share my personal information » (CCPA).

## 4. Footer (OBSERVÉ)
- **Turo** : About, Team, Policies, Careers, Press, OpenRoad
- **Locations** : USA (EN), Australia (EN), Canada (EN), Canada (FR), France (FR), UK (EN)
- **Explore** : Why choose Turo, Weddings, Pitch a trip, Trust & safety, Get help
- **Hosting** : List your car, Carculator, All-Star Hosts, Host Hub, Insurance & protection
- Réseaux : Facebook, Instagram, TikTok, YouTube ; BLOG ; App Store ; Google Play
- Sélecteur de langue ; ©2026 Turo, Inc. ; Terms ; Privacy ; Cookie preferences ; Do not sell or share

## 5. À explorer (NON EXPLORÉ)
- Menu complet une fois connecté (Trips, Inbox, Favorites, Account, Host tools…)
- Pages : how-turo-works, gift-cards-landing, insurance, host-tools, carculator, all-star-host, trust-and-safety, weddings, pitch-a-trip, list-your-car, fsd-rental
- Page de résultats de recherche (`/search`) et fiche véhicule
- Centre d'aide `/help` (arborescence complète)
