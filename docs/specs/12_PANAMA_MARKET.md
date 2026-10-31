# 12 — PANAMA : audit marché pour une marketplace de location de voitures P2P + professionnels (type Turo)

*Rédigé le 30/10/2026. Recherche documentaire uniquement (aucun contact, aucun formulaire soumis).*

## Légende des statuts

| Tag | Signification |
|---|---|
| **CONFIRMÉ** | Source primaire/officielle lue (INEC, ATP, Gaceta Oficial / Legispan, Ministerio Público, Migración, Reglamento de Tránsito) |
| **DOCUMENTÉ-SECONDAIRE** | Presse, agrégateurs, sites d'entreprises, cabinets |
| **INFÉRÉ** | Déduction de l'analyste à partir des données |
| **À VALIDER** | Doit être confirmé par un avocat / assureur / expert-comptable panaméen |

> Remarque méthodologique : plusieurs PDF officiels (Gaceta Oficial, décrets de 1989/1990 sur la location de véhicules) sont des scans non lisibles ; les points correspondants restent **À VALIDER**. Les chiffres INEC/ATP 2024-2025 sont marqués « préliminaires » par les organismes eux-mêmes.

---

## Résumé exécutif

- **Petit marché très concentré** : ~4,5 M d'habitants, **~961 000 automobiles** immatriculées (2024), dont **75 % dans la province de Panamá**. Taux de motorisation de 214 véhicules/1 000 hab. au niveau national, mais 412/1 000 dans la province de Panamá (**CONFIRMÉ**, INEC).
- **Demande touristique en croissance** : **3,0 M de visiteurs** en 2025 (+8,2 %), dont **2,24 M de visiteurs entrés par Tocumen** (corrigé VERIF_02-PA-07) ; Tocumen a traité **20,98 M de passagers** (record), mais seuls **~2,83 M de passagers débarqués sont entrés au Panama** (≈ 13,5 % du total), le reste étant du transit ou des départs (corrigé VERIF_02-PA-06) (**CONFIRMÉ** / **DOCUMENTÉ-SECONDAIRE**).
- **Aucun acteur P2P établi identifié** : Turo n'est pas présent en P2P (une présence historique de *Commercial Hosts* n'est pas exclue, cf. §1.5) ; la location informelle entre particuliers passe par Encuentra24 / réseaux sociaux, surtout pour les chauffeurs Uber/InDrive (150–175 $/semaine). Entrants régionaux P2P possibles : TripWip, Drivana (corrigé VERIF_02-PA-14).
- **Paiements** : économie dollarisée (USD) ; cartes encore minoritaires (Findex 2025, microdonnées non pondérées : ~48 % carte de débit, ~20 % carte de crédit — ordre de grandeur, corrigé VERIF_02-PA-10), wallet dominant **Yappy** (~1,4–1,6 M d'utilisateurs). **Stripe n'est pas disponible** pour une entité panaméenne (**CONFIRMÉ**, stripe.com/global) **mais, depuis une entité US ou UK, Stripe Global Payouts permet de verser des fonds en USD par virement à des particuliers au Panama** — option absente au Paraguay (**CONFIRMÉ**, docs.stripe.com, corrigé VERIF_02-X-01). **Réserve** : Stripe destine Global Payouts aux entreprises qui détiennent déjà les licences nécessaires pour transférer des fonds (pour une marketplace : *Money Transmitter Licenses*) ; le service exige Stripe Treasury et n'est ouvert qu'aux émetteurs US et GB. En Phase 0 (versements à des sociétés de location), cet avantage est sans objet (corrigé VERIF_05-V5-01). Virements instantanés **ACH Xpress** (21 banques, plafond 5 000 $ par transaction).
- **Le point bloquant est réglementaire et assurantiel** : (i) aucune norme claire trouvée autorisant un particulier à louer son véhicule à plaque « particular » contre rémunération ; (ii) l'art. 234 b) du Règlement de la circulation range le **propriétaire parmi les personnes tenues d'indemniser** les dommages causés par le conducteur responsable (le mot « solidairement » n'y figure pas ; la solidarité au-delà du plafond assuré relèverait du régime Ley 14/1993–Ley 68/2016, À VALIDER) (corrigé VERIF_02-PA-03) ; (iii) l'assurance obligatoire est très basse (5 000/10 000/5 000 B/.) et les polices privées excluent typiquement la location ; (iv) projet de loi 30-26 (ITBMS 7 % sur l'économie numérique, y compris intermédiation type Uber/Airbnb) en cours.
- **Risques opérationnels élevés** : **53 132 accidents** en 2025 (+8,7 %), 360 morts ; plus de la moitié du réseau routier non revêtue ; vols de véhicules ciblant pick-ups/4x4.

---

## 1. Parc automobile et demande

### 1.1 Parc et ventes

| Indicateur | Valeur | Statut | Source |
|---|---|---|---|
| Véhicules ayant payé la taxe de circulation (2024) | **1 002 103** (+3,2 % vs 2023), dont 961 130 automobiles et 40 973 motos | CONFIRMÉ | INEC, *Informe Transporte Año 2024* (publié 09/12/2025) — https://www.inec.gob.pa/archivos/P0705547520251209113540Informe%20completo%20Transporte%20A%C3%B1o%202024.pdf |
| Plaques par classe (2024) | 783 389 « particular » (+5,7 %), 165 863 « comercial » (−3,5 %), 11 878 officielles | CONFIRMÉ | idem, Cuadro 1 |
| Taux de motorisation (automobiles hors officiels / 1 000 hab., 2024) | **213,6** national ; **411,5** prov. Panamá ; 187,9 Chiriquí ; 186,4 Los Santos ; 64,9 Panamá Oeste ; 59,4 Colón | CONFIRMÉ | idem, Cuadro 2 |
| Répartition géographique | Panamá 712 556 (75 %) ; Chiriquí 89 583 ; Panamá Oeste 43 379 ; Veraguas 30 557 ; Colón 18 735 | CONFIRMÉ | idem |
| Biais de mesure | Le chiffre est fondé sur la vente de plaques par les trésoreries municipales : de nombreux habitants de Panamá Oeste (Arraiján, La Chorrera) immatriculent dans le district de Panamá → Panamá Oeste sous-représenté | INFÉRÉ | — |
| Typologie (véhicules passagers ≤13 places, 2024) | « Camioneta » (SUV/crossover) **344 432** ; berlines **356 207** (dont taxis) ; Jeep 7 801 ; coupés 8 604 | CONFIRMÉ | idem, Cuadro 3 |
| Pick-ups | **123 340** (dont 102 531 particuliers) ; très présents dans l'intérieur (Chiriquí 21 790, Veraguas 8 421) | CONFIRMÉ | idem, Cuadro 4 |
| Ventes de véhicules neufs 2024 | 54 384 (+11,2 %) | CONFIRMÉ | idem |
| Ventes de véhicules neufs 2025 | **60 233** (+10,8 %) ; SUV = 33 668 unités (**55,9 %**) ; Panamá + Panamá Oeste = 84,1 % du marché | DOCUMENTÉ-SECONDAIRE (ADAP/INEC via presse) | La Prensa — https://www.prensa.com/economia/la-venta-de-autos-nuevos-apunta-a-otro-record-en-2026/ ; La Estrella, 06/02/2026 — https://www.laestrella.com.pa/economia/ventas-de-vehiculos-nuevos-en-panama-crecen-108-por-impulso-de-suv-y-camiones-BO19713516 |
| Segments 2025 (variation) | SUV +17,4 % ; pick-ups +9,0 % ; minivans +15,8 % ; berlines −2,7 % ; luxe −1,2 % | DOCUMENTÉ-SECONDAIRE | La Estrella, 06/02/2026 (idem) |
| 2026 | Projection ADAP ~63 000 unités ; +12,7 % à mai 2026 | DOCUMENTÉ-SECONDAIRE | La Estrella — https://www.laestrella.com.pa/economia/ventas-de-autos-nuevos-en-panama-crecen-un-127-a-mayo-de-2026-impulsadas-por-suvs-y-marcas-asiaticas-OF23409689 |
| Crédit auto | Encours ~2 212 M$, morosité la plus faible du système | DOCUMENTÉ-SECONDAIRE | La Estrella — https://www.laestrella.com.pa/economia/prestamos-de-autos-alcanzan-2212-millones-y-mantienen-la-morosidad-mas-baja-del-sistema-financiero-LG17225790 |
| Retards de plaques | Plaques 2026–2030 retardées (refrendo Contraloría) ; >65 000 véhicules en permis temporaire à Panamá | DOCUMENTÉ-SECONDAIRE | Telemetro (2026) — https://www.telemetro.com/nacionales/attt-espera-refrendo-contraloria-nuevas-placas-vehiculares-alcaldia-mantiene-permisos-temporales-n6068882/amp |

**Lecture produit (INFÉRÉ)** : l'offre P2P potentielle est essentiellement constituée de SUV compacts (Hyundai/Kia/Toyota/marques chinoises en forte croissance), de berlines (Kia Picanto, Hyundai Accent, Toyota Yaris) et de pick-ups (Hilux, L200) — ces derniers étant à la fois les plus demandés pour l'intérieur et les plus volés.

### 1.2 Tourisme et transport aérien

| Indicateur | Valeur | Statut | Source |
|---|---|---|---|
| Visiteurs 2025 | **3 004 266** (+8,2 %) : 2 330 677 touristes (78 %), 344 408 croisiéristes, 329 181 excursionnistes | CONFIRMÉ | ATP, *Informe estadístico enero a diciembre 2025* (publié 03/2026) — https://www.atp.gob.pa/wp-content/uploads/2026/03/Informe-estadistico-enero-a-diciembre-2025.pdf |
| Entrées par Tocumen | **2 244 078** visiteurs (+10,0 %), 75 % des entrées | CONFIRMÉ | idem |
| Paso Canoas (frontière Costa Rica) | 106 006 (+2,9 %) | CONFIRMÉ | idem |
| Autres ports d'entrée | 309 774 (−4,2 %) | CONFIRMÉ | idem |
| Dépenses | 6 583 M B/. de devises (+9,7 %) ; séjour moyen ~8 jours ; 2 191 B/. par séjour, ~274 B/. par jour | CONFIRMÉ | idem |
| Occupation hôtelière 2025 | ~56,6 % | CONFIRMÉ | idem |
| Origines (via Tocumen) | Amérique du Sud 36,1 % (Colombie 343 432, Équateur 114 847, Argentine 82 748, Brésil 77 827, Venezuela 61 502) ; Amérique du Nord 28,4 % (**États-Unis 494 685**, Mexique 89 652, Canada 53 427) ; Europe 13,8 % (Espagne 77 421, Italie 36 345, France 35 999, Allemagne 32 364, Pays-Bas 29 644, R-U 25 126) ; Amérique centrale 11,7 % (Costa Rica 85 298) | CONFIRMÉ | idem |
| Saisonnalité | Pic décembre–avril (saison sèche + croisières) ; creux mai–sept. | CONFIRMÉ (données mensuelles) | idem |
| Passagers Tocumen 2025 (total, y.c. transit) | **20 981 855** (+8,6–9 %) ; 2026 : objectif 22,6 M | DOCUMENTÉ-SECONDAIRE (communiqué Tocumen S.A. via presse) | La Estrella — https://www.laestrella.com.pa/panama/nacional/aeropuerto-de-tocumen-alcanza-record-historico-de-pasajeros-en-2025-y-lidera-la-puntualidad-aerea-mundial-ML19127193 |
| Part du transit | INEC 2024 (vols internationaux) : 11,96 M passagers comptés dont 7,15 M en transit direct, 2,43 M embarqués, 2,38 M débarqués (périmètre INEC, **non comparable** aux ~19,2 M de Tocumen pour 2024). Indicateur à retenir : **2 831 531 passagers débarqués entrés au Panama en 2025** (≈ 13,5 % des 20,98 M) ; **2 244 078 visiteurs étrangers via Tocumen** (ATP). Le ratio « 60 % transit » appliqué aux 20,98 M est **supprimé** (corrigé VERIF_02-PA-06) | CONFIRMÉ (INEC) / DOCUMENTÉ-SECONDAIRE (Tocumen via presse) | INEC *Informe Transporte 2024* (idem) ; Revista E&N — https://www.revistaeyn.com/centroamericaymundo/aeropuerto-de-tocumen-movilizo-record-de-209-millones-de-pasajeros-en-2025-HH28942533 |
| Panama Stopover | 195 000–200 000 touristes attendus en 2025 (escale gratuite Copa) | DOCUMENTÉ-SECONDAIRE | La Estrella — https://www.laestrella.com.pa/economia/panama-stopover-preve-record-de-200000-turistas-al-cierre-del-2025-KH16557278 |
| Aéroports régionaux Tocumen S.A. (David–Enrique Malek, Río Hato–Scarlett Martínez, Panamá Pacífico, Colón–Enrique Jiménez) | **781 871** passagers 2025 (+3 %), pas de détail par aéroport | DOCUMENTÉ-SECONDAIRE | La Prensa, 20/01/2026 — https://www.prensa.com/economia/aeropuertos-regionales-de-tocumen-s-a-movilizaron-781871-pasajeros-duarnte-2025/ |
| Albrook (Marcos A. Gelabert, vols domestiques vers Bocas, David, San Blas) | Opérations 2024 −5,8 % ; passagers domestiques +4,2 % (pas de total trouvé) | CONFIRMÉ | INEC *Informe Transporte 2024* |

**Lecture (INFÉRÉ)** : le vivier touristique « location-compatible » est d'environ 2,2–2,3 M de touristes/an, dont une forte part nord-américaine et européenne habituée à louer (et à Turo pour les Américains). Les Stopover (2–7 jours) et les Centro/Sud-Américains en visite familiale/affaires sont des segments courts. Les croisiéristes et les passagers en transit ne sont pas une cible.

### 1.3 Expatriés, nomades numériques, voyageurs d'affaires

| Point | Détail | Statut | Source |
|---|---|---|---|
| Permis de résidence | 39 773 permis traités jan–sept 2024 (+8 105 vs 2023) ; Colombie et Venezuela en tête ; janv. 2025 : 2 810 traités / 2 634 approuvés | DOCUMENTÉ-SECONDAIRE (La Estrella, chiffres 2024) ; CONFIRMÉ (Migración, PDF officiel, chiffres janv. 2025 seulement) (précisé A24-15) | La Estrella — https://www.laestrella.com.pa/economia/panama-aumentan-los-permisos-de-residencia-a-extranjeros-YF9124472 ; Migración — https://www.migracion.gob.pa/wp-content/uploads/PERMISOS-DE-RESIDENCIA-2025.pdf |
| Visa nomade numérique (« visa de corta estancia como trabajador remoto ») | Décret exécutif **198 de 2021** ; revenus étrangers ≥ **36 000 $/an** ; 9 mois + 9 mois renouvelables ; assurance santé requise | DOCUMENTÉ-SECONDAIRE (cabinet) + CONFIRMÉ (liste des pièces Migración) | Kraemer Law — https://kraemerlaw.com/en/articles/visa-for-remote-workers-digital-nomads-executive-decree-198-of-may-7-2021/ ; Migración — https://www.migracion.gob.pa/wp-content/uploads/18.REQUISITOS-PARA-SOLICITAR-VISA-DE-CORTA-ESTANCIA-COMO-TRABAJADOR-REMOTO.pdf |
| Point clé pour la location | Un **résident** n'a plus le droit de conduire avec son permis étranger (seuls les touristes ont 90 jours) → les nouveaux expatriés en attente de licence panaméenne sont un risque de conformité | CONFIRMÉ (art. 110 Reglamento) + DOCUMENTÉ-SECONDAIRE | voir §3.4 (corrigé VERIF_02-PA-08) |
| Nomades numériques (visa DE 198/2021) | **Art. 111** du Règlement : « los extranjeros con permisos especiales de estadía en el país, solamente podrán conducir con permiso de la ATTT », sur présentation du permis étranger et d'une certification consulaire. Les titulaires du visa de travailleur à distance ne sont pas des touristes : ils relèvent **vraisemblablement** de l'art. 111 et ne peuvent donc pas conduire avec leur seul permis étranger. Le segment « nomades » est **exposé à un risque de conformité** (corrigé VERIF_02-PA-02) | DOCUMENTÉ-SECONDAIRE (texte lu dans la copie IMASEVI 2013, non officielle) / **À VALIDER** (qualification du visa DE 198 en « permiso especial de estadía ») | https://www.imasevi.com/descargas/reglamento_attt_imasevi.pdf (art. 111, extrait le 30/10/2026) |
| Voyageurs d'affaires | Panama = hub régional (sièges régionaux / régime SEM, hub Copa) ; pas de statistique dédiée trouvée | INFÉRÉ | — |

### 1.4 Location courte vs longue durée, et chauffeurs VTC

| Point | Détail | Statut | Source |
|---|---|---|---|
| Taille du secteur location (historique) | ANAV : ~10 000 véhicules, 28 entreprises, ~77 M$/an, 50 % clients étrangers, durée de vie des voitures parfois ~9 mois (état des routes) | DOCUMENTÉ-SECONDAIRE — **daté de nov. 2014** | Panamá América — https://www.panamaamerica.com.pa/economia/77-millones-de-dolares-al-ano-genera-alquiler-de-autos |
| Prix (enquête ACODECO 2018) | Petite voiture dès 19,95 $/j TTC assurance incluse ; berline 36,95–47,57 $/j ; jusqu'à 180 $/j | DOCUMENTÉ-SECONDAIRE (30/07/2018) | Panamá América — https://panamaamerica.com.pa/economia/en-panama-se-puede-alquilar-un-auto-hasta-por-20-diarios-1112154 |
| Prix agrégateurs (Kayak, consulté 30/10/2026) | « Dès » 5–9 $/j hors assurance obligatoire ; moyenne SUV ~30 $/j, pick-up ~36 $/j, van ~52 $/j ; mois le plus cher = mars (~21 $/j moyenne), le moins cher = septembre | DOCUMENTÉ-SECONDAIRE | https://www.kayak.com/Cheap-Panama-City-Car-Rentals.18478.cars.ksp |
| Réalité du prix final | L'assurance responsabilité civile (TPL) est **exigée au comptoir** et n'est pas incluse dans les tarifs agrégateurs ; les assurances de cartes US « peuvent ne pas couvrir » au Panama ; cautions jusqu'à 500 $ et plus | DOCUMENTÉ-SECONDAIRE | National Car Rental (Albrook/Tocumen) — https://www.nationalcar.com/en/car-rental-locations/pa/panama-city-albrook-int-airport-k908.html |
| Prix final réaliste | Économique **35–55 $/j** TTC assurance incluse ; SUV compact 55–80 $/j ; pick-up 4x4 70–110 $/j. Fourchette unique retenue dans tout le fichier (le §5.4 citait 40–60 $/j) (corrigé VERIF_02-PA-09) | INFÉRÉ (à vérifier par mystery shopping) | — |
| Chauffeurs VTC | ATTT estime ~**20 000** chauffeurs de plateformes ; >500 000 utilisateurs | DOCUMENTÉ-SECONDAIRE | La Prensa — https://www.prensa.com/sociedad/uber-e-indrive-reaccionan-al-nuevo-decreto-que-regula-plataformas-y-taxis-de-lujo-en-panama/ ; Telemetro, 18/04/2026 — https://www.telemetro.com/nacionales/indrive-advierte-nuevas-reglas-del-transporte-panama-podrian-afectar-miles-conductores-n6076521 |
| Location de voitures pour VTC | Annonces Encuentra24 : Kia Picanto « pour Uber » **150 $/semaine** + 150 $ de caution ; autre annonce 174 $/semaine ; agences (Express Rent a Car) ciblant InDrive | DOCUMENTÉ-SECONDAIRE | https://www.encuentra24.com/panama-en/cars-auto-trucks-rent ; https://expressrentpanama.com/ |
| Instabilité réglementaire VTC | Décret exécutif **10 du 16/04/2026** (plateformes = « taxis de luxe », plaques spéciales, adhésion à une *prestataria*, Panaméens uniquement) **annulé** quelques jours plus tard par le président Mulino pour consultation élargie ; le décret 331 de 2017 (licence spéciale, Panaméens > 21 ans) reste la référence | DOCUMENTÉ-SECONDAIRE | La Estrella, 17/04/2026 — https://www.laestrella.com.pa/panama/nacional/decreto-uber-panama-2026-vs-2017-que-cambia-en-la-regulacion-del-transporte-por-apps-BC21677042 ; Revista E&N, 20/04/2026 — https://www.revistaeyn.com/empresasymanagement/gobierno-de-panama-anula-reglamentacion-de-plataformas-de-transporte-CE30251311 |

**Lecture (INFÉRÉ)** : la demande locale (50 % historiquement) est un levier aussi important que le tourisme : remplacement pendant réparation, week-ends à la plage (Coronado, Pedasí, Boquete), déménagements (pick-ups), et la **location hebdomadaire/mensuelle aux chauffeurs VTC**. Ce dernier segment est **celui qui a fait échouer HyreCar (Getaround US, liquidé en 2025) et Moobie (Brésil, opérations suspendues)** : kilométrage intensif, sinistralité et usure élevées, impayés, fraude, et risque qu'une future réglementation exige plaques spéciales / propriété du véhicule. **Recommandation atténuée** : exclure le segment VTC du MVP et du P2P entre particuliers ; ne l'ouvrir qu'à des **flottes professionnelles** (loueurs/renting avec plaques commerciales, assurance flotte, caution, télématique et coupe-circuit) après 6–12 mois de données de sinistralité (corrigé VERIF_02-C-06).

### 1.5 Concurrence

| Acteur | Observations | Statut | Source |
|---|---|---|---|
| Grupo Panama Car Rental (PCR) – **Automarket Rent a Car** | Leader local ; >3 000 véhicules, 15 agences ; a mis fin à >20 ans de franchise Dollar pour lancer sa propre marque (7/02/2025) ; 13 points à Panamá City | DOCUMENTÉ-SECONDAIRE — **auto-déclaré (communiqué payé, rubrique « notas de prensa »)** (corrigé VERIF_05-V5-17) | La Prensa (nota de prensa) — https://www.prensa.com/notas-de-prensa/grupo-panama-car-rental-empresa-lider-movilizando-panama-lanza-automarket-rent-a-car/ ; https://www.grupopcr.com.pa/ |
| Internationaux présents | Hertz, Avis, Budget, Thrifty, Dollar, Alamo, National, Enterprise, Sixt, Europcar, Firefly, Green Motion, Mex Rent a Car, Ace, Routes | DOCUMENTÉ-SECONDAIRE | Kayak (idem) ; Rentcars — https://www.rentcars.com/es-ar/company/automarket/panama/airports/pt2-panama-provincia-de-panama ; Enterprise Panamá — https://www.enterprisepanama.com/ |
| Locaux | Ancón Rent a Car, Arrendadora Económica (« sans dépôt ni carte de crédit »), Express Rent a Car, Panarental, Panarenting (renting/leasing) | DOCUMENTÉ-SECONDAIRE | https://www.anconrentcar.com/ ; https://www.arrendadoraeconomica.com/ ; https://panarental.com/en/home/ |
| P2P / autopartage | **Aucune plateforme P2P établie trouvée.** Turo n'opère en P2P qu'aux États-Unis, Canada, R-U, Australie, France (CONFIRMÉ, help.turo.com). Son programme **Commercial Host** a historiquement listé des loueurs pros dans 56 pays (Phocuswire, ≈ 2018–2019), ce qui peut expliquer l'article russe (vc.ru, 18/09/2025) évoquant Turo et Zipcar à Panamá City. Une recherche web « turo.com Panama City, Panama » (30/10/2026) ne renvoie que Panama City (Floride) : **aucune annonce Turo au Panama trouvée**. Statut retenu : « Turo absent en P2P ; présence B2B passée possible via Commercial Hosts, non confirmée » (corrigé VERIF_02-PA-13) | DOCUMENTÉ-SECONDAIRE (faible) / À VALIDER | https://vc.ru/travel/2221588-karsharing-v-paname-mify-i-realnost ; https://www.phocuswire.com/Turo-adds-rental-agencies-new-funding |
| Entrants P2P régionaux | **TripWip** (Uruguay, Argentine, Mexique ; seed 4,2 M$ en juillet 2026 ; commission 20–25 % côté propriétaire + frais locataire) et **Drivana** (Mexique, seed 1 M$ en 2025) : aucun n'est présent au Panama, mais tous deux sont en phase d'expansion LATAM. Voir `sources/SRC_COMPETITORS.md` et `14_COMPETITIVE_ANALYSIS.md` (corrigé VERIF_02-PA-14) | DOCUMENTÉ-SECONDAIRE | https://www.forbesargentina.com/negocios/tripwip-startup-uruguaya-alquiler-autos-cerro-ronda-inversion-us-42-millones-escalar-mexico-argentina-n93770 ; https://www.contxto.com/en/funding/mexican-car-rental-startup-drivana-rolls-into-1-million-in-seed-funding/ |
| P2P informel | Encuentra24, Facebook Marketplace, TikTok/Instagram (« alquiler de autos para InDrive ») | DOCUMENTÉ-SECONDAIRE | https://www.tiktok.com/discover/alquiler-de-autos-para-indriver-panama?lang=es |

---

## 2. Paiements

| Point | Détail | Statut | Source |
|---|---|---|---|
| Monnaie | Le **dollar US** est monnaie légale et d'usage ; le balboa (PAB) est à parité 1:1 (pièces uniquement), pas de banque centrale émettrice → **aucun risque de change** pour des hôtes/clients US | DOCUMENTÉ-SECONDAIRE (fait notoire) | p.ex. https://payrequest.io/guides/accept-international-payments-panama-without-stripe |
| Bancarisation | Findex 2025 (enquête 2024), microdonnées Panama : **47,6 %** déclarent avoir une carte de débit ; **20,4 %** une carte de crédit (base partielle) ; presse cite 64 % de titulaires de compte, 52 % de paiements digitaux. Ces pourcentages proviennent d'une page de variable de microdonnées, non d'un indicateur pondéré publié : **ordre de grandeur seulement** ; l'indicateur pondéré de la Findex Databank 2025 n'a pas été retrouvé (corrigé VERIF_02-PA-10) | DOCUMENTÉ-SECONDAIRE (retagué, corrigé VERIF_02-PA-10) | Banque mondiale — https://microdata.worldbank.org/catalog/7962/variable/F1/V30?name=fin4 ; Revista E&N — https://www.revistaeyn.com/finanzas/ranking-de-bancarizacion-de-los-paises-de-centroamerica-segun-el-informe-global-findex-OG26642185 |
| Cartes de crédit actives | >1 M (SBP, mars 2025) ; 876 906 (APC Experian, début 2026), solde moyen 3 390 $ ; taux moyen 22,07 % ; morosité 9,2 % | DOCUMENTÉ-SECONDAIRE | La Prensa — https://www.prensa.com/economia/uso-de-tarjetas-de-credito-se-dispara-en-panama-mientras-suben-las-tasas-y-la-morosidad/ |
| Carte de débit locale **Clave** (réseau Telered) | >2 M de cartes ; souvent **non acceptée** par des PSP internationaux ; supportée par dLocal | DOCUMENTÉ-SECONDAIRE | Finextra (dLocal) — https://www.finextra.com/pressarticle/84450/dlocal-enters-three-new-markets-in-latin-america-and-the-caribbean |
| **Yappy** (Banco General) | 487 M de transactions en 2024 (431 M P2P, 56 M commerçants) ; ~1,4 M d'utilisateurs (juillet 2024), Tilopay cite >1,6 M ; ouvert à d'autres banques (Caja de Ahorros) ; commission marchand ~1 % + ITBMS (source tierce) | DOCUMENTÉ-SECONDAIRE | La Prensa — https://www.prensa.com/economia/transformacion-digital-yappy-pega-el-salto/ ; Tilopay — https://tilopay.com/guias/pasarelas/guia-yappy ; Adobe Commerce — https://commercemarketplace.adobe.com/onetree-module-yappy-payment.html |
| Virements | **ACH Directo** (Telered, classique J+0/J+1) et **ACH Xpress** (instantané 24/7, **21 banques**, plafond relevé à **5 000 $ par transaction** en sept. 2024 ; chaque banque limite en outre le nombre de transactions par jour (1 ou 2) → les payouts d'hôtes > 5 000 $ passent par ACH Directo (corrigé VERIF_02-PA-12) ; paiement par numéro de mobile depuis mars 2025 – BNP et BAC en premier) ; Q1 2025 : 816 000 tx / 165,8 M$ | DOCUMENTÉ-SECONDAIRE | Panamá América — https://www.panamaamerica.com.pa/economia/ach-xpress-ahora-cuenta-con-21-bancos-afiliados-1248906 ; Telemetro — https://www.telemetro.com/nacionales/5000-es-el-nuevo-limite-ach-xpress-transacciones-inmediatas-18-bancos-n6004768 ; La Estrella — https://www.laestrella.com.pa/economia/transacciones-con-ach-xpress-alcanzo-los-1658-millones-en-el-primer-trimestre-de-2025-HC12678953 |
| Wallets fintech | Zinli (Banco Mercantil) première fintech connectée à ACH Xpress | DOCUMENTÉ-SECONDAIRE | Revista E&N — https://www.revistaeyn.com/finanzas/zinli-es-la-primera-fintech-en-panama-en-permitir-transferencias-interbancarias-KH30378570 |
| **Stripe** | **Non disponible** pour une entité panaméenne (pays absent de la liste ; en LATAM seuls le Brésil et le Mexique figurent) ; contournement via entité US/UK (Stripe Atlas) | **CONFIRMÉ** (retagué, corrigé VERIF_02-X-01) | https://stripe.com/global |
| **Stripe Global Payouts** (depuis entité US ou UK) | Le Panama figure parmi les pays destinataires : **PA / USD / Wire**, pour des destinataires **« Company » et « Individual »** (informations requises : email, nom, adresse). Pour le **Paraguay**, le changelog Stripe du 27/05/2026 ajoute `py_bank_account` (API preview), mais la liste « Supported recipient countries » relue le 30/10/2026 ne le mentionne pas : **PY non confirmé, À VALIDER (OQ-PAY-20)** (reporté 09b §8 ; corrigé VERIF_08-V8-04). Architecture possible : entité US + Stripe (encaissement des cartes internationales, pré-autorisation de caution) + Global Payouts vers les hôtes panaméens. Limites : virement international (délai et frais bancaires de réception à vérifier) ; Stripe Connect transfrontalier reste réservé aux plateformes US/UK/EEE/CA/CH ; question fiscale et « remesas » (voir ligne Régulation des flux) (corrigé VERIF_02-X-01). **Conditions d'usage (relues le 30/10/2026)** : (i) Stripe écrit que Global Payouts « is best for businesses that already hold the licenses required to move money themselves » ; la page de comparaison vise les marketplaces « that have the necessary Money Transmitter Licenses (MTLs) » et précise « If you manage your customers' funds, you might need a license such as an MTL », alors que Connect est « Covered by Stripe's licensing » (mais Connect transfrontalier n'atteint pas le Panama) ; (ii) **Stripe Treasury requis** (versements depuis un *financial account* que la plateforme alimente) ; (iii) émetteurs **US et GB** seulement (UE en *private preview*). Une entité US qui encaisse le loyer puis le reverse aux hôtes « gère les fonds de ses clients » : elle peut devoir détenir des MTL d'État aux États-Unis ou passer par un prestataire tiers : dLocal (PSP), ou Localpayment, qui est **enregistré** auprès de la SBP comme émetteur de moyens de paiement au seul titre de la prévention du blanchiment (Résolution SBP-PSO-R-2024-00010, code MP-012) et **n'est pas titulaire d'une licence** de transmission de fonds (reporté 09b §8 ; corrigé VERIF_08-V8-05). **En Phase 0, les bénéficiaires sont des sociétés de location : l'argument « particuliers » ne joue qu'en Phase 1** (corrigé VERIF_05-V5-01) | **CONFIRMÉ** (docs Stripe lues le 30/10/2026) / **À VALIDER** (besoin de MTL : avocat US) | https://docs.stripe.com/global-payouts/recipient-requirements ; https://docs.stripe.com/connect/cross-border-payouts ; https://docs.stripe.com/global-payouts ; https://docs.stripe.com/connect/cross-border-payouts-to-recipients/compare-global-payouts |
| dLocal | Pay-ins (cartes internationales, Clave) et **payouts par virement bancaire** au Panama | DOCUMENTÉ-SECONDAIRE (docs éditeur) | https://docs.dlocal.com/docs/panama-payouts-v3.md |
| Localpayment | Payouts ACH Panama, min 1 $ / max 999 999 $, exécution T+0 (09b §2.9 : ACH USD le jour même, cut-off 14 h, min 1 $, sans maximum, CONFIRMÉ). **Statut réglementaire** : la page de l'éditeur se dit « Licenciado » comme « Emisor de Medios de Pago — SBP y UAF », mais la Résolution SBP-PSO-R-2024-00010 du 5/01/2024 formalise un **enregistrement** comme émetteur de moyens de paiement et sujet obligé, supervisé par la SBP **uniquement en matière de prévention du blanchiment** (code MP-012) : **ce n'est pas une licence** de transmission de fonds ni de casa de remesas ; aucun pay-in au Panama, payouts financés par un solde préfinancé (la plateforme détiendrait les fonds en secours, OQ-PAY-05, OQ-PAY-21) (reporté 09b §8 ; corrigé VERIF_08-V8-05) | DOCUMENTÉ-SECONDAIRE / CONFIRMÉ (résolution SBP lue, 09b §2.9) | https://docs.localpayment.com/docs/panama ; https://superbancos.gob.pa/documents/laws_regulations/resolution_prevention_REDEMP/2024/Resolution_00010-2024.pdf |
| PagueloFacil | Acquéreur/PSP local (cartes Visa/MC, Clave, PagoCash) ; frais cités ~3,5 % + 0,50 $ (+1 % cartes internationales) — source concurrente | DOCUMENTÉ-SECONDAIRE | https://apps.shopify.com/paguelofacil ; https://nowpayments.io/blog/payment-gateways-panama |
| Tilopay | PSP régional (CR/PA) intégrant Yappy | DOCUMENTÉ-SECONDAIRE | https://tilopay.com/sobre-tilopay |
| BAC Credomatic / Banco General / Cybersource | Acquéreurs bancaires majeurs ; Cybersource (Visa) utilisé comme passerelle par les banques — **conditions marketplace/split non trouvées** | À VALIDER | — |
| PayPal | Retrait vers comptes bancaires panaméens possible (via MetroBank/Kipo depuis 02/2022, puis retraits directs) | DOCUMENTÉ-SECONDAIRE | Panamá América — https://panamaamerica.com.pa/economia/empresas-panamenas-podran-integrarse-la-plataforma-de-paypal-1200697 ; Revista E&N — https://www.revistaeyn.com/finanzas/paypal-habilita-retiro-de-dinero-en-bancos-de-costa-rica-panama-y-el-salvador-EB17074257 |
| Mercado Pago / Nequi | **Pas d'opération identifiée au Panama** (Nequi est colombien) | INFÉRÉ | — |
| Usage du cash | 140 000 utilisateurs d'Uber payaient en espèces (article ancien) → cash encore important dans la mobilité | DOCUMENTÉ-SECONDAIRE (ancien) | https://www.panamaamerica.com.pa/economia/en-panama-hay-140-mil-usuarios-de-uber-que-pagan-en-efectivo-1145465/amp |
| Fraude | ABP 2025 : ~125 M$ de tentatives/soupçons, ~20 M$ de fraudes confirmées ; >5 000 plaintes pour escroquerie jan–nov 2025 (+10 %) | DOCUMENTÉ-SECONDAIRE | Revista Summa — https://revistasumma.com/ciberataques-en-panama-sector-bancario-reporta-us125-millones-en-fraudes/ |
| Chargebacks | Aucune statistique publique trouvée | À VALIDER (auprès de l'acquéreur) | — |
| Régulation des flux | **Casas de remesas de dinero** : **autorisation (licence) délivrée par le MICI, Dirección General de Empresas Financieras (Ley 48 du 23/06/2003)**, demande par avocat, délai légal ≤ 30 jours ouvrables, inscription au Registro de Casas de Remesas, rapports trimestriels ; **la SBP n'intervient qu'au titre de la prévention du blanchiment** (registre et supervision LBC, Ley 23 de 2015 mod. Ley 21 de 2017). Question ouverte : le reversement aux hôtes constitue-t-il une activité de casa de remesas ? (corrigé VERIF_02-PA-01) ; **avant-projet de loi fintech n° 314** (déposé 13/01/2026 : licences différenciées, sandbox, amendes jusqu'à 2 M$) non encore adopté | DOCUMENTÉ-SECONDAIRE / CONFIRMÉ (guide MICI, aviso SBP) | LexLatin — https://lexlatin.com/entrevistas/anteproyecto-ley-314-panama-regular-fintech-inversion ; MICI, Guía n° 3 — https://empresasfinancieras.mici.gob.pa/wp-content/uploads/2021/12/GUIA-No.-3-REQUISITOS-CASA-DE-REMESAS-DE-DINERO.pdf ; Ley 48/2003 — https://mici.gob.pa/wp-content/uploads/2021/09/03-01-ley48.pdf ; SBP — https://www.superbancos.gob.pa/documentos/leyes_y_regulaciones/comunicados/2023/aviso7-2023.pdf |

**Architecture de paiement recommandée (INFÉRÉ)** : (1) Pay-in cartes internationales via un PSP régional/global (dLocal, Adyen ou Cybersource via BAC) **ou via Stripe depuis une entité US/UK** avec **pré-autorisation de caution** ; (2) Yappy + carte Clave pour la clientèle locale (via Tilopay/PagueloFacil/dLocal) ; (3) payouts hôtes via **ACH Directo/Xpress** depuis un compte bancaire local de l'entité, via payout API (dLocal ; Localpayment, simple enregistrement SBP au titre de la LBC et non licence, avec solde préfinancé détenu par la plateforme : OQ-PAY-21) (reporté 09b §8), **ou via Stripe Global Payouts (USD, virement, particuliers acceptés)** depuis l'entité US/UK (corrigé VERIF_02-X-01), **sous réserve de licences MTL et de Stripe Treasury** (corrigé VERIF_05-V5-01) ; (4) éviter de détenir les fonds des hôtes sans conseil juridique (risque de qualification « remesas »/fintech). **En Phase 0, option privilégiée : l'agence encaisse le loyer (avec son propre PSP local, Yappy compris, et émet sa facture électronique) et la plateforme facture sa commission ; à défaut, PSP licencié agissant comme encaisseur** (corrigé VERIF_05-V5-20).

---

## 3. Réglementation

### 3.1 Location de véhicules (« arrendamiento de vehículos » / « rent a car »)

| Point | Détail | Statut | Source |
|---|---|---|---|
| Textes historiques spécifiques | **Décret 17 du 13/04/1989** (location de véhicules à des étrangers) et **Décret exécutif 188 du 08/05/1990** (location de véhicules à moteur) existent — PDF scannés, contenu et vigueur non vérifiés | À VALIDER | https://docs.panama.justia.com/federales/decretos/17-de-1989-apr-13-1989.pdf ; https://docs.panama.justia.com/federales/decretos-ejecutivos/188-de-1990-may-8-1990.pdf |
| Activité commerciale | Toute entreprise doit avoir un **Aviso de Operación** (Panamá Emprende/MICI) ; le leasing financier exige licence MICI + capital minimum 100 000 B/. (Ley 7 de 1990, DE 76 de 1996) — ce régime **ne vise pas** la location courte durée | DOCUMENTÉ-SECONDAIRE / CONFIRMÉ (texte MICI) | https://mici.gob.pa/wp-content/uploads/2021/09/04-02-ley-7-1990.pdf ; https://mici.gob.pa/wp-content/uploads/2021/09/04-01-decreto-ejecutivo-76-1996.pdf |
| Plaques des véhicules de location | Le Règlement distingue plaques **particular** (« uso privado de la persona o empresa propietaria ») et **comercial** (« actividad comercial y que por el servicio que presta recibe un pago ») ; aucune catégorie « rent a car » explicite trouvée | CONFIRMÉ (définitions INEC/ATTT) | INEC *Informe Transporte 2024*, « Conceptos y definiciones » |
| **Un particulier peut-il louer sa voiture à plaque « particular » ?** | **Aucune base légale explicite trouvée** dans un sens ou dans l'autre. La définition « comercial = reçoit un paiement pour le service » crée un **risque de requalification**. Les sanctions documentées visent le transport *de passagers* non autorisé (amende 1 000 $, retrait de licence, grue) et non la location sans chauffeur | **À VALIDER (point n°1)** | TVN — https://www.tvn-2.com/nacionales/transporte/ATTT-endurece-sanciones-diablos-rojos_0_4873012751.html |
| Tourisme | Régime d'incitations Ley 80 de 2012 / Registro Nacional de Turismo ; aucune mention des loueurs ; fenêtre d'inscription prolongée jusqu'au 31/12/2025 | DOCUMENTÉ-SECONDAIRE | Pardini & Asociados — https://www.pardinilaw.com/EN/padela/news/149/panama-incentives-for-local-tourism |
| Plateformes d'intermédiation | Pas de loi générale ; le seul régime sectoriel est celui du transport de passagers (DE 331/2017 ; DE 10/2026 annulé). Projet de loi **229** sur les entreprises opérant via plateformes mentionné en presse | DOCUMENTÉ-SECONDAIRE / À VALIDER | voir §1.4 ; https://www.panamaamerica.com.pa/economia/panama-regulara-el-itbms-en-la-economia-digital-y-plataformas-como-airbnb-1265331 |

### 3.2 Responsabilité et assurance obligatoire

| Point | Détail | Statut | Source |
|---|---|---|---|
| Assurance obligatoire (SOBAT) | **Ley 68 du 13/12/2016** (G.O. 28177-B) : les **propriétaires** doivent souscrire une assurance obligatoire de base avec les montants minimum du Règlement ; pas d'exclusions opposables aux tiers, pas de franchise opposable aux tiers, couverture même en cas d'alcool ; modèle de police fixé par la Superintendencia de Seguros y Reaseguros (SSRP). *(NB : la « Ley 68 de 2003 » évoquée dans la demande correspond en réalité à la Ley 68 de 2016.)* | **CONFIRMÉ** | Legispan — https://s3-legispan.asamblea.gob.pa/legispan/NORMAS/2010/2016/LEY/Administrador%20Legispan_28177-B_2016_12_14_ASAMBLEA%20NACIONAL_68.pdf |
| Montants minimum (art. 236, Reglamento de Tránsito, DE 640 de 2006) | Dommages aux biens d'autrui **5 000 B/.** ; lésions corporelles **5 000 B/. par personne / 10 000 B/. par accident** | DOCUMENTÉ-SECONDAIRE (copie non officielle du Règlement, édition 2013, texte relu le 30/10/2026) — **la Ley 68/2016 a pour objet de fixer la couverture de la police obligatoire : ses articles de couverture et la police SOBAT en vigueur n'ont pas été relus ; montants À VALIDER** (point laissé ouvert, VERIF_02-PA-04) | Règlement (copie IMASEVI) — https://www.imasevi.com/descargas/reglamento_attt_imasevi.pdf ; police SOBAT Ancón — https://www.asegurancon.com/wp-content/uploads/2019/09/COMPLETO_CONDICIONES_GENERALES_SOAT.pdf |
| **Responsabilité du propriétaire** (art. 234) | « Sin perjuicio de la responsabilidad […] que consagre el Código Civil », sont tenus d'indemniser : a) le conducteur responsable, **b) le propriétaire du véhicule** dont le conducteur est déclaré responsable, c) l'assureur, **d) en cas de vente avec réserve de propriété : le conducteur, le vendeur et l'acheteur** (pertinent pour les véhicules financés, voir §9.5), e) le vendeur en cas de défaut de fabrication ; le propriétaire n'est exonéré qu'en cas de vol/appropriation indue/dépôt en atelier (art. 235). Le texte ne dit pas « solidairement » : la solidarité au-delà du plafond assuré viendrait du régime d'assurance (Ley 14/1993 modifiée par la Ley 68/2016, selon la presse) — À VALIDER. Le DE 640 a été modifié depuis (DE 11 de 2025, art. 241/243) (corrigé VERIF_02-PA-03) | DOCUMENTÉ-SECONDAIRE (copie d'auto-école, édition 2013 ; G.O. 25701 non lue) (retagué, corrigé VERIF_02-PA-03) | idem ; TVN — https://www.tvn-2.com/nacionales/nueva-ley-seguro-obligatorio-accidentes-transito-samir-gozaine-aseguradoras-autos-panama_1_1369158.html |
| Implication P2P | Un hôte reste exposé au-delà des plafonds (très bas) de l'assurance → la plateforme doit fournir une **RC complémentaire élevée** (p.ex. 100 000–1 000 000 $) | INFÉRÉ | — |
| Non-assurance | ~228 000 véhicules non assurés (article ancien) | DOCUMENTÉ-SECONDAIRE | https://panamaamerica.com.pa/economia/aun-existen-unos-228-mil-automoviles-que-no-estan-asegurados-en-panama-1148232 |
| Réforme | Projet de loi 53 (remise obligatoire de 25 % pour conducteurs sans sinistre, modif. Ley 68/2016) **veté** par le président (oct./nov. 2025) | DOCUMENTÉ-SECONDAIRE | La República — https://www.larepublica.co/globoeconomia/mulino-veto-el-proyecto-de-ley-53-que-otorgaba-descuentos-obligatorios-en-seguros-4261761 |
| Couverture d'une police personnelle en location payante | Les polices auto standard couvrent l'usage déclaré ; Ancón propose un **avenant « Extensión de Coberturas Auto de Alquiler »** (AU15-1097) → preuve que la location est un risque distinct, normalement exclu | DOCUMENTÉ-SECONDAIRE (document assureur) / À VALIDER | https://www.asegurancon.com/wp-content/uploads/2023/02/AA-P%C3%93LIZA-DE-SEGURO-DE-AUTOM%C3%93VIL-ANEXO-No.-AU15-1097-Extensi%C3%B3n-de-Coberturas-Auto-de-Alquiler.pdf |
| Marché de l'assurance | 22 assureurs, primes 2025 **2 105,85 M$** ; branche auto **352,4 M$ (+10,2 %)** ; sinistralité auto +19 % à avril 2026 | DOCUMENTÉ-SECONDAIRE (SSRP via presse) | La Estrella — https://www.laestrella.com.pa/economia/salud-vida-y-autos-sostienen-la-expansion-del-mercado-asegurador-en-2025-FL20091488 ; https://www.laestrella.com.pa/economia/primas-y-reclamos-crecen-en-salud-y-autos-durante-abril-2026-segun-apadea-NI23188335 |
| Assureurs partenaires potentiels | **ASSA** (leader, ~439 M$ primes 2024, réseau d'assistance ASSA Móvil 24/7), **Internacional de Seguros** (~321 M$), **MAPFRE Panamá** (~260 M$), **Aseguradora Ancón** (avenant location existant), SURA, Pan-American Life (principalement vie/santé) | DOCUMENTÉ-SECONDAIRE | Revista E&N — https://www.revistaeyn.com/finanzas/ranking-seguros-2025-aseguradoras-lideres-de-centroamerica-NA26378489 ; ASSA — https://www.assanet.com/condiciones-generales/endoso-assamovil.pdf |

### 3.3 Contrats et signature électronique

| Point | Détail | Statut | Source |
|---|---|---|---|
| Cadre | **Ley 51 du 22/07/2008** (documents et signatures électroniques, contrats électroniques), modifiée par **Ley 82 du 09/11/2012** (signature électronique qualifiée ; Registro Público = autorité certificatrice racine) ; DE 684 de 2013 | CONFIRMÉ (Gaceta / Órgano Judicial) | https://www.organojudicial.gob.pa/uploads/blogs.dir/28/2026/07/465/ley-51-de-22-de-julio-de-2008-que-define-y-regula-los-documentos-electronicos-y-las-firmas-electronicas-y-la-prestacion-de-servicios-de-almacenamiento-tecnologico.pdf ; https://registro-publico.gob.pa/images/stories/Ley82de2012atribucionesalRPPparaserAutoridadRegistradoraycertificadoraraiz.pdf |
| Conséquence | Contrat de location et état des lieux signés par click-wrap / signature simple : a priori valables ; la signature qualifiée offre la force probante d'un acte notarié | DOCUMENTÉ-SECONDAIRE / À VALIDER (force probante devant le *Juez de Tránsito*) | Viafirma — https://www.viafirma.com/en/faqs/electronic-signature-in-panama/ |

### 3.4 Identité, permis, âge

| Point | Détail | Statut | Source |
|---|---|---|---|
| Permis étranger (touriste) | Art. 110 : les touristes ne peuvent obtenir de permis panaméen et peuvent conduire avec le **permis valide de leur pays pendant 90 jours** (non prorogeable) | **CONFIRMÉ** | Reglamento de Tránsito (DE 640) — https://www.imasevi.com/descargas/reglamento_attt_imasevi.pdf |
| Résidents étrangers | Doivent obtenir un permis panaméen (art. 109 : « Los panameños y los extranjeros con residencia autorizada ») ; conduire avec un permis étranger une fois résident = infraction | DOCUMENTÉ-SECONDAIRE | https://www.expatden.com/es/panama-es/conducir-en-panama/ |
| **Étrangers avec permis spécial de séjour** (art. 111) | Ne peuvent conduire **qu'avec un permis de l'ATTT**, délivré sur présentation de leur permis étranger et d'une certification de la représentation diplomatique. Concerne vraisemblablement les titulaires du visa de travailleur à distance (DE 198/2021). **Conséquence produit** : le contrôle à la réservation doit distinguer trois cas : (1) touriste entré depuis < 90 jours (tampon d'entrée) avec permis étranger ; (2) titulaire d'un visa ou permis spécial avec **permis ATTT** ; (3) résident avec permis panaméen (corrigé VERIF_02-PA-02) | DOCUMENTÉ-SECONDAIRE (copie IMASEVI) / À VALIDER | https://www.imasevi.com/descargas/reglamento_attt_imasevi.pdf |
| Permis international | Sources contradictoires sur son exigence/acceptation | À VALIDER | https://championmotors.com.pa/blog/36 |
| Âge minimum de conduite | **18 ans** (art. 109) | CONFIRMÉ | Reglamento |
| Âge minimum de location (pratique) | 21 ans chez les loueurs (surcharge jeune conducteur fréquente jusqu'à 25 ans) | DOCUMENTÉ-SECONDAIRE | Panamá América 2014 (idem) |
| Identité | Cédula (Panaméens), cédula E (résidents), passeport + tampon d'entrée (touristes : permet de prouver les 90 jours) | INFÉRÉ | — |

### 3.5 Protection des données

| Point | Détail | Statut | Source |
|---|---|---|---|
| Cadre | **Ley 81 du 26/03/2019** (en vigueur depuis le **29/03/2021**) ; règlement **DE 285 du 28/05/2021** (corrigé VERIF_02-PA-11) ; autorité : **ANTAI** | CONFIRMÉ (SBP, Circular 063-2021 — https://www.superbancos.gob.pa/documentos/leyes_y_regulaciones/circulares/2021/circular-063-2021.pdf) / DOCUMENTÉ-SECONDAIRE | ANTAI, guide secteur privé — https://www.antai.gob.pa/wp-content/uploads/2024/01/GUIA-SECTOR-PRIVADO-1.pdf ; LexLatin — https://lexlatin.com/entrevistas/reglamento-la-ley-proteccion-datos-panama |
| Principes | Bases légales dont consentement, information préalable, transferts transfrontaliers soumis à garanties (notion d'« exportateur ») | DOCUMENTÉ-SECONDAIRE | vLex DE 285 — https://vlex.com.pa/vid/decreto-ejecutivo-285-2021-1049776104 |
| Points d'attention | Hébergement hors Panama, données de géolocalisation (GPS), scans de permis/passeports, vérification biométrique, notification de violation, montant des sanctions | À VALIDER | — |

### 3.6 Fiscalité

| Point | Détail | Statut | Source |
|---|---|---|---|
| ITBMS (TVA) | Taux général **7 %** ; 10 % hébergement | DOCUMENTÉ-SECONDAIRE | La Estrella, 20/08/2026 — https://www.laestrella.com.pa/economia/panama-plataformas-digitales-deberan-emitir-factura-electronica-y-cobrar-7-de-itbms-BE25031819 |
| Économie numérique | **Projet de loi 30-26** approuvé en Conseil de cabinet le **18/08/2026** (articles de presse datés du 19) : étendre l'ITBMS 7 % aux plateformes (Uber, Airbnb, Netflix…), facture électronique par transaction, critères de localisation (compte bancaire, adresse, IP, SIM) ; ~100 M$/an attendus. **Statut** : projet transmis à l'Assemblée nationale, puis règlement d'application à venir ; **pas encore loi**. Les articles « Panamá frena » (Bloomberg Línea) et « MEF descarta » (La Estrella) sont **antérieurs** au projet d'août 2026 et ne décrivent pas son état actuel (date exacte non vérifiée) (corrigé VERIF_02-PA-05) | DOCUMENTÉ-SECONDAIRE | idem ; Telemetro — https://www.telemetro.com/nacionales/itbms-plataformas-digitales-quien-pagaria-el-7-panama-n6089045 ; (antérieur) Bloomberg Línea — https://www.bloomberglinea.com/latinoamerica/panama/panama-frena-proyecto-para-aplicar-impuesto-a-plataformas-como-amazon-netflix-y-spotify/ |
| ITBMS sur la location (commission plateforme + loyer de l'hôte) | Une entité locale facturerait l'ITBMS sur sa commission ; question ouverte sur l'ITBMS dû par des hôtes particuliers (seuil d'assujettissement) et sur une éventuelle obligation de collecte par la plateforme | **À VALIDER** | — |
| Facture électronique | Ley 256 de 2021 ; Résolution DGI **201-6299 du 29/07/2025** : depuis le 01/01/2026, émission via **PAC** obligatoire pour contribuables au-delà de certains seuils (presse : >36 000 B/. de revenus ou >100 factures/mois) | DOCUMENTÉ-SECONDAIRE (seuils) / À VALIDER | Edicom — https://edicomgroup.com/es/blog/estado-factura-electronica-panama ; Alegra — https://blog.alegra.com/panama/facturacion-electronica-panama/ |
| Impôt sur le revenu | Système **territorial** (revenus de source panaméenne) ; IS 25 % ; barème IR des personnes 0/15/25 % ; retenues sur paiements à non-résidents | INFÉRÉ (connaissance générale) / À VALIDER | — |
| Taxe touristique / aéroportuaire sur la location | Aucune taxe spécifique trouvée ; les loueurs mentionnent « taxes et surcharges locales », redevance de concession à Tocumen non publiée | À VALIDER | National — https://www.nationalcar.com/en/car-rental-locations/pa/tocumen-international-airport-k912.html |

### 3.7 Protection du consommateur

| Point | Détail | Statut | Source |
|---|---|---|---|
| Autorité | **ACODECO** (Ley 45 de 2007) ; tableau public des plaintes | DOCUMENTÉ-SECONDAIRE | https://www.acodeco.gob.pa |
| Location | ACODECO a sanctionné des débits de caution non justifiés : l'autorisation contractuelle de débiter la carte ne suffit pas sans **preuve documentée** du dommage ; 13 plaintes location au S1 2018 (13 222 $) dont 6 pour débits indus | DOCUMENTÉ-SECONDAIRE | Panamá América — https://www.panamaamerica.com.pa/opinion/sobre-los-cobros-indebidos-en-el-alquiler-de-autos-1119564 |
| Implication produit | Photos horodatées check-in/check-out, processus de litige transparent, contrat en espagnol | INFÉRÉ | — |

---

## 4. Risques opérationnels

| Risque | Données | Statut | Source |
|---|---|---|---|
| **Accidents** | **53 132 accidents en 2025** (+8,7 %) ; 17 405 blessés ; **360 morts** (≈1/jour) ; province de Panamá 58,3 %, Panamá Oeste 15,1 %, Chiriquí 9,3 % ; 83,9 % collisions ; pic le vendredi ; morts surtout le week-end | **CONFIRMÉ** | INEC, *Accidentes de tránsito año 2025* (publié 10/08/2026) — https://www.inec.gob.pa/archivos/P0579518620260810122019ACCIDENTES%20DE%20TRANSITO%20A%C3%91O%202025.pdf |
| Fréquence de sinistre | 53 132 accidents / ~1 M véhicules ≈ **5 accidents déclarés pour 100 véhicules/an** (hors petits accrochages non déclarés) | INFÉRÉ | — |
| Vols de véhicules | 819 vols (« hurtos ») en 2024 (+11 %) ; 2026 YTD (avril) : 170 plaintes vs 241 un an plus tôt, 112 récupérés ; zones : Bellavista, San Francisco, Betania, puis Chiriquí et Panamá Oeste ; cibles : pick-ups et 4x4, clés volées, commandes « sur mesure », trafic d'ECU | DOCUMENTÉ-SECONDAIRE | Panamá América — https://panamaamerica.com.pa/sucesos/aumentan-11-los-hurtos-de-vehiculos-en-panama-durante-2024-1245316 ; TVN, 22/04/2026 — https://www.tvn-2.com/nacionales/ciudad-panama-chiriqui-oeste-zonas-mayores-casos-de-robo-hurtos-autos_1_2237512.html |
| Vols avec violence (toutes catégories) | 5 332 notices de « robo » en 2025 (+2 %), Panamá Oeste +17 %, Chiriquí +27 % | CONFIRMÉ | Ministerio Público, déc. 2025 — https://ministeriopublico.gob.pa/wp-content/uploads/Informe-Estadistico-de-Delitos-de-Robo-Diciembre-2025.pdf |
| Exportation vers le Costa Rica | En baisse grâce aux contrôles frontaliers ; GPS a permis des récupérations au Costa Rica | DOCUMENTÉ-SECONDAIRE | TVN (idem) ; Panamá América — https://www.panamaamerica.com.pa/provincias/la-tecnologia-sorprende-los-delincuentes-en-la-frontera-entre-panama-y-costa-rica-1149410/amp |
| Routes | Réseau de **17 881 km** (2024) : hormigón 411, base béton/asphalte 416, asphalte 4 675, traitement superficiel 2 995, **revêtu (gravier) 3 995, terre 5 389** → ~52 % non revêtu | CONFIRMÉ | INEC *Informe Transporte 2024*, Cuadro 21 (source MOP) |
| Conséquence | Usure prématurée (suspension, pneus) ; exiger 4x4/pick-up pour certaines destinations (Darién, Azuero rural, montagnes de Chiriquí) ; interdire certaines routes dans le contrat | INFÉRÉ | — |
| Assistance routière | ASSA Móvil (24/7, téléphone/WhatsApp) ; Panamá Asistencia S.A. (prestataire de programmes bancaires) ; BAC (plafond grue 250 $) ; ~37 sociétés de grues autorisées par l'ATTT dans la province de Panamá (donnée ancienne) | DOCUMENTÉ-SECONDAIRE | https://www.assanet.com/condiciones-generales/endoso-assamovil.pdf ; https://pa.scotiabank.com/content/dam/scotiabank/international/panama/Espanol/Condicionado_Asistencia_Premium.pdf ; https://www.prensa.com/impresa/panorama/Envio-gruas-urge-mejoras_0_4538546255.html |
| GPS / récupération | Détektor présent dans la région ; offres télématiques constructeurs (p.ex. connectHyundai Petroautos) ; pas de cartographie fiable des fournisseurs locaux | DOCUMENTÉ-SECONDAIRE / À VALIDER | https://hyundai.petroautos.com/assets/hyundai-plus/condicionado-de-uso-connectHyundai-Petroautos-2026.pdf |
| **Péages (Panapass / ENA)** | Corredor Norte et Sur, autoroutes Panamá–Colón : télépéage **Panapass** (sticker prépayé) ; passage sans solde = **amende ATTT 10 $** par passage (Rés. AL-154, G.O. 28022-A du 03/05/2016), cumulative ; ~10 000 conducteurs/mois sans solde ; 15 M$ d'impayés ; immobilisation possible ; dette Panapass bloque le *paz y salvo* ATTT | DOCUMENTÉ-SECONDAIRE | La Prensa — https://www.prensa.com/sociedad/atencion-entra-en-vigor-la-multa-por-transitar-sin-credito-en-los-corredores/ ; La Estrella — https://www.laestrella.com.pa/panama/nacional/morosidad-en-corredores-ronda-los-15-millones-de-dolares-GG24443612 ; Telemetro, 17/04/2025 — https://www.telemetro.com/nacionales/conductores-deberan-saldar-su-deuda-panapass-avanzar-el-tramite-paz-y-transito-n6036476 |
| **Amendes (« boletas ») ATTT** | Un décret de 2025 (DE 11, modif. art. 241/243 du DE 640) impute certaines infractions **au propriétaire** même s'il ne conduisait pas ; fotomultas en phase pilote (feu rouge 100 $, excès de vitesse 50 $) | DOCUMENTÉ-SECONDAIRE | Gaceta Oficial (référence) — https://www.gacetaoficial.gob.pa/pdfTemp/30007_B/104004.pdf ; Panamá América — https://www.panamaamerica.com.pa/sociedad/extienden-periodo-de-prueba-de-fotomulta-1245118 |
| Implication | La plateforme doit gérer la **ré-imputation des amendes et péages** au locataire (process type Turo « tolls & tickets ») ; impossible de transférer légalement une boleta propriétaire → refacturation contractuelle | INFÉRÉ | — |
| Remise des clés | Pratique attendue : remise en main propre (centres commerciaux, parkings de Tocumen/Albrook) ; boîtes à clés peu adaptées au risque de vol ; serrures connectées → à piloter sur flotte pro | INFÉRÉ | — |
| Langue | Service client **espagnol obligatoire** (contrats, ACODECO, police) ; **anglais indispensable** (28 % des touristes nord-américains + expatriés) | INFÉRÉ (à partir des données ATP) | — |

---

## 5. Opportunités et adaptations produit

1. **Démarrer en modèle « pro-first / hybride »** (INFÉRÉ) : onboarder d'abord des loueurs locaux de petite taille et des flottes (y compris leasing/renting) qui disposent déjà de plaques commerciales, d'assurance flotte et d'un *Aviso de Operación*, puis ouvrir le P2P particulier une fois la question des plaques « particular » levée par avis juridique / accord ATTT.
2. **Assurance embarquée obligatoire** (INFÉRÉ) : police collective avec ASSA / Mapfre / Internacional / Ancón couvrant RC complémentaire élevée + dommages + vol, activée par réservation ; exploiter l'existence de l'avenant « Auto de Alquiler » d'Ancón comme preuve de faisabilité.
3. **Segment chauffeurs VTC — hors MVP, flottes professionnelles uniquement** (INFÉRÉ) : la demande existe (150–200 $/semaine, ~20 000 chauffeurs), mais c'est le segment qui a coulé HyreCar (Getaround US) et Moobie (Brésil) : sinistralité, usure, impayés, fraude. **Pas d'hôtes particuliers sur ce segment.** Ouverture possible en phase 2 à des loueurs/renting pros (plaques commerciales, assurance flotte, caution, télématique + coupe-circuit), et seulement si le futur règlement plateformes (DE 10/2026 annulé, consultation en cours) ne l'interdit pas (corrigé VERIF_02-C-06).
4. **Segment touristes nord-américains/européens** (INFÉRÉ) : livraison à Tocumen / Albrook / Panamá Pacífico et à David (Boquete), **sous réserve des règles de concession aéroportuaire (non trouvées, voir §9.7)** ; tarification « tout compris » (assurance obligatoire incluse) pour se différencier de l'opacité des loueurs (prix agrégateur 5–9 $/j vs 35–55 $/j réels au comptoir, corrigé VERIF_02-PA-09) ; vérification de la date d'entrée (règle des 90 jours).
5. **Week-ends & intérieur** (INFÉRÉ) : pick-ups et SUV 4x4 pour Coronado, Pedasí, Boquete, Bocas (via Almirante), Santa Catalina ; restrictions géographiques (Darién, routes en terre) et kilométrage plafonné.
6. **Paiements locaux** (INFÉRÉ) : Yappy et ACH Xpress pour la clientèle locale non titulaire de carte de crédit (ordre de grandeur ~80 % des adultes, chiffre non pondéré, voir §2), avec caution remplacée par un **dépôt Yappy remboursable** ou un produit d'assurance-caution ; payouts hôtes J+1 via ACH.
7. **Panapass intégré** (INFÉRÉ) : obliger un sticker Panapass actif, recharges refacturées automatiquement.
8. **Expatriés / nomades** (INFÉRÉ) : location mensuelle avec contrôle du statut en **trois cas** : touriste < 90 jours avec permis étranger ; titulaire d'un visa/permis spécial de séjour (dont nomades DE 198/2021) **uniquement avec permis ATTT (art. 111)** ; résident avec permis panaméen. Le segment nomades est plus étroit qu'annoncé : beaucoup n'auront pas fait la démarche ATTT (corrigé VERIF_02-PA-02).
9. **Antivol** (INFÉRÉ) : GPS + coupe-circuit exigés pour pick-ups/4x4 et voitures > 25 000 $ ; remise des clés physique ; vérification d'identité renforcée (selfie + cédula/passeport + carte au nom du locataire).
10. **Conformité facture électronique** dès J1 via un PAC (INFÉRÉ).

---

## 6. Principaux risques

| # | Risque | Gravité | Commentaire |
|---|---|---|---|
| 1 | Illégalité possible de la location de véhicules particuliers à plaque « particular » / requalification en activité commerciale | Élevée | Aucune norme claire ; décrets 1989/1990 non lus |
| 2 | Obligation d'indemniser du propriétaire (art. 234 b ; solidarité au-delà du plafond à valider) + plafonds obligatoires très bas | Élevée | Exige une RC complémentaire robuste (corrigé VERIF_02-PA-03) |
| 3 | Disponibilité d'un assureur pour du P2P | Élevée | Branche auto sous pression (sinistralité +19 % 2026) |
| 4 | Sinistralité routière (~5 accidents/100 véhicules/an) et routes non revêtues | Élevée | Impact direct sur le loss ratio |
| 5 | Vol de pick-ups/4x4, fraude d'identité | Moyenne-élevée | GPS obligatoire |
| 6 | Paiements : pas de Stripe local (mais Global Payouts possible depuis US/UK), faible pénétration des cartes de crédit, cautions difficiles, qualification « casa de remesas » des reversements | Moyenne | Solutions locales existent (corrigé VERIF_02-X-01 / PA-01) |
| 7 | Fiscalité numérique mouvante (projet 30-26), facture électronique PAC | Moyenne | Coût de conformité |
| 8 | Instabilité réglementaire VTC (DE 10/2026 annulé) | Moyenne | Segment chauffeurs exposé |
| 9 | Taille du marché limitée (~1 M de véhicules, 2,3 M touristes) | Moyenne | Plafonne le TAM ; marché « tremplin » régional |
| 10 | Litiges consommateurs (ACODECO) sur cautions/dommages | Faible-moyenne | Process de preuve |
| 11 | Conducteurs non autorisés : nomades/visas spéciaux sans permis ATTT (art. 111) | Moyenne | Contrôle de statut à la réservation (corrigé VERIF_02-PA-02) |
| 12 | Réserve constitutionnelle sur le commerce de détail (art. 288 du texte consolidé ; « 293 » dans les annexes TLC), dont la définition inclut la « representación o agencia », appliquée à une plateforme détenue par des étrangers | NON VALIDÉ (potentiellement éliminatoire) | Voir §9.1 et §10 ; avis d'avocat indispensable (corrigé VERIF_05-V5-03) |
| 13 | Segment VTC (modèle HyreCar/Moobie) | Élevée si ouvert au P2P | Exclu du MVP ; flottes pros seulement (corrigé VERIF_02-C-06) |

---

## 7. Questions pour les professionnels locaux

### Avocat (droit administratif / transport / tech)
1. Un particulier peut-il légalement louer, contre rémunération, un véhicule immatriculé en plaque **particular** ? Faut-il une plaque **comercial** ou une autorisation ATTT ? Quelles sanctions ?
2. Les **Décrets 17 de 1989 et 188 de 1990** (location de véhicules) sont-ils en vigueur ? Quelles obligations imposent-ils (registre, contrat type, assurance, inspection) ?
3. Une marketplace étrangère doit-elle constituer une société panaméenne, obtenir un *Aviso de Operación* et pour quel code d'activité (intermédiation vs location) ?
4. L'encaissement pour compte de tiers et le reversement aux hôtes constituent-ils une activité de **casa de remesas** soumise à licence MICI (Ley 48/2003), avec registre LBC auprès de la SBP (Ley 23/2015) ? Quid de la future loi fintech 314 ? Le recours à Stripe Global Payouts depuis une entité US change-t-il l'analyse ? (corrigé VERIF_02-PA-01)
4 bis. La **réserve constitutionnelle du commerce de détail** (art. 288 du texte consolidé ; « 293 » dans les annexes des TLC) s'applique-t-elle à une société détenue par des étrangers qui loue des véhicules aux consommateurs ou qui intermédie cette location, compte tenu de la définition « venta al consumidor o representación o agencia de empresas productoras [o] mercantiles » ? (corrigé VERIF_05-V5-03)
5. Valeur probante d'un contrat signé électroniquement (Ley 51/2008) devant le **Juez de Tránsito** et en cas de litige ACODECO ?
6. Comment transférer contractuellement au locataire les **boletas** imputées au propriétaire (DE 11 de 2025) et les impayés Panapass ?
7. Exigences de la Ley 81/2019 et du DE 285/2021 : enregistrement, transferts hors Panama, données GPS et biométriques, notification de violation, sanctions.
8. Validité du permis international et contrôle de la règle des 90 jours pour les touristes ; position pour les résidents titulaires d'un permis étranger ; **le visa de travailleur à distance (DE 198/2021) est-il un « permiso especial de estadía » au sens de l'art. 111, imposant un permis ATTT ?** (corrigé VERIF_02-PA-02)
9. Impact potentiel d'une future réglementation des plateformes (type DE 10/2026) sur la location de véhicules à des chauffeurs VTC.

### Assureur / courtier
1. Existe-t-il un produit de **police collective par réservation** (RC + dommages + vol) pour véhicules de particuliers loués via plateforme ? Quels assureurs (ASSA, Mapfre, Internacional, Ancón, SURA) seraient ouverts ?
2. Les polices auto personnelles excluent-elles la location payante ? L'avenant Ancón « Auto de Alquiler » (AU15-1097) est-il utilisable pour des particuliers ?
3. Limites RC recommandées au-delà du minimum 5 000/10 000/5 000 B/. ; coût indicatif par jour.
4. Franchises, exigences antivol (GPS, coupe-circuit), exclusions géographiques (routes en terre, Darién, sortie vers le Costa Rica).
5. Sinistralité de la branche auto et des flottes de location ; tarifs pour chauffeurs VTC.
6. Approbation des produits par la SSRP : délai et procédure.

### Expert-comptable / fiscaliste
1. ITBMS 7 % sur la commission de la plateforme et sur le loyer de l'hôte : qui est redevable ? Seuil d'assujettissement d'un particulier ?
2. Effet du **projet de loi 30-26** sur une plateforme étrangère et sur une filiale locale (collecte, facture électronique par transaction).
3. Obligations de facture électronique (Rés. 201-6299 / PAC) et seuils applicables ; facturation au nom de l'hôte ?
4. Retenues à la source sur paiements aux hôtes, obligations déclaratives (type reporting des revenus des hôtes à la DGI).
5. IS 25 % et régime territorial pour une filiale locale ; retenue sur redevances/services payés à la maison-mère.
6. Existence de taxes spécifiques (aéroport, tourisme, municipales) sur la location de véhicules.

---

## 8. Synthèse notée (1 = défavorable, 5 = très favorable)

| Dimension | Note | Justification |
|---|---|---|
| **Demande** | **3,5 / 5** | 3,0 M de visiteurs (+8 %), 2,24 M de visiteurs via Tocumen, mix nord-américain/européen familier de la location ; forte demande locale. La demande VTC (~20 000 chauffeurs) **n'est plus comptée dans la note** car le segment est exclu du MVP (corrigé VERIF_02-C-06). Marché petit (~1 M de véhicules, 4,5 M hab.), ~2,8 M de passagers débarqués entrés seulement sur 20,98 M (corrigé VERIF_02-PA-06), croisiéristes non cibles. |
| **Paiements** | **3 / 5** (relevée à 3,5 par VERIF_02-X-01, ramenée à 3, corrigé VERIF_05-V5-01) | USD (aucun risque de change), ACH Xpress instantané, Yappy massif, dLocal/Localpayment/PSP locaux disponibles, Stripe Global Payouts vers des particuliers en USD depuis une entité US/UK **(réservé aux plateformes titulaires de licences MTL, avec Stripe Treasury ; utile seulement en Phase 1)**. Mais pas de Stripe local, ~20 % des adultes avec carte de crédit (ordre de grandeur), carte Clave mal acceptée, cautions difficiles, reversements pour compte de tiers potentiellement soumis à licence MICI (casas de remesas). |
| **Réglementation** | **2 / 5** (critère **éliminatoire**, non compensable : voir §10) | Signature électronique et protection des données claires ; mais incertitude majeure sur la location de véhicules particuliers, obligation d'indemniser du propriétaire (art. 234 b), réserve constitutionnelle du commerce de détail à qualifier, art. 111 pour les visas spéciaux, assurance obligatoire basse, fiscalité numérique en évolution (30-26), régime VTC instable. |
| **Opérations** | **2 / 5** | 53 132 accidents/an (~5/100 véhicules), 52 % de routes non revêtues, vols ciblant pick-ups/4x4, péages Panapass et amendes imputées au propriétaire ; assistance (ASSA Móvil) et GPS disponibles ; marché très concentré sur Panamá City, ce qui facilite la logistique. |
| **Concurrence** | **3,5 / 5** vue P2P, Phase 1 (ramenée de 4, corrigé VERIF_02-PA-14) ; **2,5 / 5 en pro-first** dans la matrice §10.2, face aux agrégateurs Kayak, Expedia, Rentcars, VIP Cars et aux sites des loueurs (corrigé VERIF_05-V5-04) | Aucun acteur P2P établi ; loueurs traditionnels nombreux (Automarket, Hertz, Avis…) avec tarification opaque ; concurrence informelle (Encuentra24, réseaux sociaux) mais sans confiance ni assurance. Risque d'arrivée de Turo limité à court terme, mais entrants P2P régionaux financés (TripWip, Drivana) en expansion LATAM. |
| **Global** | *Moyenne simple supprimée* (corrigé VERIF_02, remarque sur les notes globales) | Une moyenne masque le caractère **éliminatoire** de la réglementation et de l'assurance. La comparaison décisionnelle est faite au §10 avec critères bloquants puis critères pondérés. Lecture : marché **attractif comme test régional** (dollarisé, hub aérien, payouts USD possibles, peu de concurrence P2P), à condition de démarrer en modèle pro-first et de lever d'abord les points juridiques et assurantiels. |

---

## 9. Sujets décisionnels complémentaires (Phase 5, réponse à VERIF_02 §3)

*Recherche web du 30/10/2026. « Non trouvé » signifie qu'aucune source publique n'a été identifiée ; rien n'est extrapolé au-delà des sources.*

### 9.1 Création de société, propriété étrangère et réserve du commerce de détail

| Point | Constat | Statut | Source |
|---|---|---|---|
| Forme | Sociedad Anónima (SA) ou S. de R.L. ; un étranger peut détenir 100 % d'une SA panaméenne (pratique notoire) ; agent résident (avocat) obligatoire | DOCUMENTÉ-SECONDAIRE | KPMG, *Panama Investment 2026* — https://assets.kpmg.com/content/dam/kpmgsites/pa/pdf/Panama-ES-Investment-2026.pdf |
| Taxe annuelle | **Tasa única de 300 $/an** par personne morale ; suspension par le Registro Público après 3 ans d'impayés ou sans agent résident | DOCUMENTÉ-SECONDAIRE | KPMG (idem) ; La Estrella — https://www.laestrella.com.pa/economia/200129-millon-sociedades-anonimas-suspendidas-EPLE420026 |
| Aviso de Operación | Obtenu en ligne sur **Panamá Emprende** (MICI) ; coût cité 50 ou 55 B/. selon les sources | DOCUMENTÉ-SECONDAIRE / À VALIDER (montant) | KPMG (idem) ; https://www.prensa.com/opinion/notas-tributarias-al-obtener-un-aviso-de-operacion/ |
| **Réserve constitutionnelle du commerce de détail** | La Constitution réserve le **commerce au détail** aux Panaméens de naissance, à certains naturalisés, aux étrangers qui l'exerçaient en 1972 et aux personnes morales formées par ces personnes ; les étrangers non autorisés peuvent seulement participer à des sociétés vendant les produits qu'elles fabriquent. **Numérotation retenue : art. 288 du texte consolidé** (Justia, relu le 30/10/2026 ; l'art. 293 y porte sur l'interdiction des monopoles privés). Les annexes de réserves des TLC publiées par le MICI citent « art. 293 » selon une numérotation antérieure (corrigé VERIF_05-V5-03). **Définition (art. 288, dernier alinéa, repris par les annexes TLC)** : « Ejercer el comercio al por menor significa dedicarse a la venta al consumidor o a la **representación o agencia** de empresas productoras [o] mercantiles o cualquiera otra actividad que la Ley clasifique como perteneciente a dicho comercio ». L'argument « la location est un service et non une vente » **ne suffit donc pas** : une marketplace qui agit comme **agent ou mandataire de loueurs** auprès de consommateurs peut tomber dans la branche « representación o agencia ». Le même article prévoit des sanctions contre l'exercice « por medio de interpuesta persona », ce qui fragilise le montage par prête-nom. **Aucune source ne tranche** l'application à la location ou à l'intermédiation de location (corrigé VERIF_05-V5-03) | CONFIRMÉ (texte constitutionnel, Justia) / DOCUMENTÉ-SECONDAIRE (annexes TLC) / **À VALIDER — NON VALIDÉ, potentiellement éliminatoire pour une entité 100 % étrangère** | Justia — https://panama.justia.com/federales/constitucion-politica-de-la-republica-de-panama/titulo-x/ ; MICI, Anexo I Lista de Panamá — https://mici.gob.pa/wp-content/uploads/2022/06/anexo-i-lista-de-panama.pdf |
| Contournements possibles | (i) Entité opératrice étrangère (US) facturant un service numérique d'intermédiation **au loueur** (et non au consommateur), les loueurs/hôtes restant les prestataires locaux et contractant directement avec le locataire ; (ii) associé panaméen majoritaire dans l'entité locale (attention à la clause « interpuesta persona ») ; (iii) avis de l'avocat sur la qualification « servicio » et sur la branche « representación o agencia » (corrigé VERIF_05-V5-03) | INFÉRÉ | — |

### 9.2 Change, rapatriement des fonds et fiscalité des flux sortants

| Point | Constat | Statut | Source |
|---|---|---|---|
| Change | Économie dollarisée, pas de banque centrale émettrice ; aucun contrôle des changes identifié | DOCUMENTÉ-SECONDAIRE | voir §2 |
| Dividendes | Retenue de **10 %** sur les dividendes issus de bénéfices de source panaméenne | DOCUMENTÉ-SECONDAIRE | Commenda — https://www.commenda.io/panama/corporate-tax-rates ; Deloitte *Tax highlights 2026* — https://www.deloitte.com/content/dam/assets-shared/docs/services/tax/2026/dttl-tax-panamahighlights-2026.pdf |
| Services / redevances payés à la maison-mère | Retenue **12,5 % effective** en droit interne (impôt de 25 % appliqué à 50 % du montant remis), due si la dépense est déduite au Panama (art. 694 du Code fiscal selon Chambers) ; à défaut de retenue, la dépense n'est pas déductible. **Pas de contradiction avec PwC** : PwC donne aussi 12,5 % en droit interne ; le taux de **7,5 %** ne figure que dans son tableau des **conventions** (honoraires : Barbade, Vietnam, Espagne si les services sont rendus au Panama). **Aucune convention Panama–États-Unis n'apparaît dans ce tableau** : pour une entité US, retenir 12,5 % (à valider) (corrigé VERIF_05-V5-08) | DOCUMENTÉ-SECONDAIRE / À VALIDER (comptable) | PwC (relu le 30/10/2026) — https://taxsummaries.pwc.com/Panama/Corporate/Withholding-taxes ; Chambers 2026 — https://gpg-pdf.chambers.com/Doing-Business-In-2026/833/ ; Chambers 2025 — https://gpg-pdf.chambers.com/international-tax-2025/340/ |
| Territorialité | Revenus de source étrangère exonérés ; une plateforme étrangère sans présence au Panama n'est imposée que sur la source panaméenne (portée du projet 30-26 à suivre, §3.6) | DOCUMENTÉ-SECONDAIRE | Deloitte (idem) |

### 9.3 Rails de versement aux hôtes particuliers

| Rail | Particuliers | Devise / délai | Statut | Source |
|---|---|---|---|---|
| **Stripe Global Payouts** (entité US ou GB) | **Oui** (« Individual » : email, nom, adresse) | USD, virement international ; frais et délai non relevés ; **exige Stripe Treasury et, pour une marketplace qui gère les fonds de ses clients, possiblement des licences MTL ; sans objet en Phase 0 (bénéficiaires = sociétés)** (corrigé VERIF_05-V5-01) | CONFIRMÉ (liste) / À VALIDER (licences) | https://docs.stripe.com/global-payouts/recipient-requirements ; https://docs.stripe.com/connect/cross-border-payouts-to-recipients/compare-global-payouts |
| dLocal Payouts | Oui (B2C, P2P) | USD, virement bancaire | CONFIRMÉ (doc éditeur) | https://docs.dlocal.com/docs/panama-payouts-v3.md |
| Localpayment | Oui (ACH) | USD, T+0, 1 $ à 999 999 $ | DOCUMENTÉ-SECONDAIRE | https://docs.localpayment.com/docs/panama |
| ACH Directo / ACH Xpress (compte local de l'entité) | Oui | USD ; Xpress ≤ 5 000 $/transaction, 1–2 tx/jour selon la banque | DOCUMENTÉ-SECONDAIRE | §2 |
| Yappy (versement API vers un particulier) | **Non trouvé** (API marchande d'encaissement documentée, pas d'API de versement) | — | non trouvé | — |
| KYC des hôtes | Cédula / cédula E + compte bancaire au nom de l'hôte ; besoin d'un RUC pour l'hôte particulier : **non trouvé** | — | À VALIDER | — |
| Coût par versement | **Non trouvé** pour tous les rails (tarifs non publics) | — | non trouvé | — |

### 9.4 Disponibilité d'un produit d'assurance P2P / location chez un assureur local

- **Aucun produit d'assurance P2P (propriétaire particulier mettant son véhicule en location via une plateforme) n'a été trouvé** chez un assureur panaméen. **Non trouvé.**
- Produits voisins existants : **Ancón**, avenant AU15-1097 « Extensión de Coberturas Auto de Alquiler » (applicable seulement s'il est inclus dans la police d'origine de l'assuré) ; **ASSA**, formulaire « Solicitud de auto en alquiler » et endossement ASSA Ride ; **MAPFRE Panamá**, formulaire « Solicitud de Auto de Alquiler ». Ces produits **étendent la police de l'assuré à un véhicule de location** (logique locataire ou véhicule de remplacement) : ils prouvent une capacité de souscription « location », **pas** un produit pour propriétaire-hôte. DOCUMENTÉ-SECONDAIRE (documents assureurs) — https://www.asegurancon.com/wp-content/uploads/2023/02/AA-P%C3%93LIZA-DE-SEGURO-DE-AUTOM%C3%93VIL-ANEXO-No.-AU15-1097-Extensi%C3%B3n-de-Coberturas-Auto-de-Alquiler.pdf ; https://www.assanet.com/formularios/solicitud-de-auto-en-alquiler.pdf ; https://www.mapfre.com.pa/media/Solicitud-de-Auto-de-Alquiler.pdf
- Les loueurs professionnels disposent de polices flotte (TPL exigée au comptoir, CDW avec franchise jusqu'à 3 500 $ chez National) : **un modèle pro-first n'a a priori pas besoin d'un nouveau produit d'assurance, sous réserve de la lecture des polices flotte** (aucune n'a été lue : on ignore si elles couvrent une location distribuée via une plateforme tierce). C'est une condition bloquante de la Phase 0 (§10.3, condition 6) (corrigé VERIF_05-V5-06). DOCUMENTÉ-SECONDAIRE — https://www.nationalcar.com/es/oficinas-de-alquiler-de-autos/pa/plaza-albrook-ciudad-de-panama-k906.html
- Procédure et délai d'approbation d'un produit par la **SSRP** : **non trouvé**. Besoin de réassurance / *fronting* : **non trouvé**. Coût indicatif par jour : **non trouvé**. Référence régionale : MAPFRE a souscrit une police dédiée au car-sharing P2P au Brésil (Pegcar), ce qui rend un partenariat avec MAPFRE Panamá plausible (INFÉRÉ).

### 9.5 Véhicules financés ou nantis

- **Art. 234 d)** du Règlement : en cas de **vente avec réserve de propriété**, le conducteur, **le vendeur et l'acheteur** sont tenus d'indemniser. Le prêteur/vendeur est donc exposé si le véhicule est loué. DOCUMENTÉ-SECONDAIRE (copie IMASEVI, texte relu le 30/10/2026).
- Encours de crédit auto ~2 212 M$ (§1.1) : une part importante du parc récent est vraisemblablement financée (INFÉRÉ).
- Clauses des contrats de crédit auto panaméens interdisant la location : **non trouvé** (aucun contrat type public lu). Filtre d'éligibilité recommandé : déclaration de libre gravamen, ou consentement écrit du prêteur (INFÉRÉ / À VALIDER).

### 9.6 Plaques, import et contrôle technique

- Deux catégories pertinentes : **particular** (usage privé) et **comercial** (« recibe un pago ») ; **aucune catégorie « rent a car » spécifique trouvée** (§3.1). CONFIRMÉ (définitions INEC).
- Délivrance des plaques : inspection du véhicule (revisado) et *paz y salvo* ATTT et municipal exigés (article de 2005, possiblement daté). DOCUMENTÉ-SECONDAIRE — https://www.panamaamerica.com.pa/nacion/el-significado-de-las-placas-208947
- Retards 2026 : plus de 65 000 véhicules en permis temporaire (§1.1).
- Coût et délai d'un passage de plaque particular → comercial : **non trouvé**. Règles d'âge maximum à l'import : **non trouvé**.

### 9.7 Concessions aéroportuaires (Tocumen, Albrook)

- Tocumen S.A. attribue ses espaces commerciaux par licitation, avec droit d'entrée, redevance mensuelle et minimum garanti (cas du duty free). DOCUMENTÉ-SECONDAIRE — https://www.prensa.com/impresa/economia/Autorizan-licitar-duty-terminal-Tocumen_0_4674282612.html
- Règles applicables aux **loueurs** (comptoirs, redevance) et à la **livraison d'un véhicule par un hôte P2P en zone d'arrivée** : **non trouvé**. Les loueurs mentionnent des « taxes et surcharges locales » à Tocumen (§3.6). La livraison P2P à l'aéroport doit être considérée comme **non autorisée tant qu'elle n'est pas validée** (À VALIDER auprès de Tocumen S.A.) ; repli : remise au parking public ou à un point hors emprise.

### 9.8 Obligations anti-blanchiment (LBC/KYC) de la plateforme

- **Ley 23 de 2015** : superviseurs désignés : SBP, SSRP, SMV, IPACOOP et **Intendencia de Supervisión y Regulación de Sujetos no Financieros** (MEF), qui supervise environ 12 000 sujets non financiers (immobilier, zones franches, casinos…). **Les casas de remesas relèvent de la supervision LBC de la SBP**, et non de l'Intendencia (aviso SBP 7-2023 ; cohérent avec §2 et VERIF_02 constat 17) ; la mention « casas de remesas » dans la liste de l'Intendencia est retirée (corrigé VERIF_05-V5-09) — https://www.superbancos.gob.pa/documentos/leyes_y_regulaciones/comunicados/2023/aviso7-2023.pdf. Les sujets obligés non financiers doivent s'enregistrer. Un projet vise à transformer l'Intendencia en Superintendencia. DOCUMENTÉ-SECONDAIRE — https://cnbc.mef.gob.pa/wp-content/uploads/2022/10/ley-23-de-2015.pdf ; https://www.panamaamerica.com.pa/economia/se-concreta-creacion-de-superintendencia-de-sujetos-no-financieros-1153513
- Une **marketplace de location de véhicules n'apparaît dans aucune liste de sujets obligés trouvée** ; elle le deviendrait vraisemblablement si elle était qualifiée de casa de remesas (§2). À VALIDER. Recommandation : KYC complet hôtes et locataires (pièce d'identité, selfie, compte bancaire au nom de l'hôte), conservation longue des pièces (durée légale non vérifiée), procédure interne de signalement (INFÉRÉ).

### 9.9 Procédure en cas d'accident

- Les responsabilités sont tranchées lors d'une **audience devant le Juez de Tránsito** (art. 235 : le propriétaire y présente ses preuves). DOCUMENTÉ-SECONDAIRE (copie du Règlement).
- Interdiction de déplacer le véhicule, délai d'obtention du *parte*, durée moyenne d'immobilisation et coût moyen d'un sinistre : **non trouvé**. Hypothèse de modèle : immobilisation de 7 à 21 jours après un sinistre avec dommages (INFÉRÉ, à valider par l'assureur).

### 9.10 Reporting fiscal des revenus des hôtes

- **Aucune obligation actuelle** pour une plateforme de déclarer les revenus des hôtes à la DGI ou d'opérer une retenue n'a été trouvée. **Non trouvé.**
- Le projet 30-26 (§3.6) imposerait aux plateformes une facture électronique par transaction et la collecte de l'ITBMS : il pourrait créer de facto un reporting. À VALIDER.

### 9.11 Circulation transfrontalière (Paso Canoas, Costa Rica)

- Côté Costa Rica, les loueurs (Alamo, Enterprise, National à Paso Canoas) fixent leurs propres politiques de passage ; les assurances étrangères ne couvrent généralement pas au Costa Rica. DOCUMENTÉ-SECONDAIRE — https://www.alamo.com/es/oficinas-de-alquiler-de-autos/cr/paso-canoas-ljpe.html
- Règles douanières panaméennes et costariciennes pour un véhicule loué à un tiers (autorisation notariée, etc.) : **non trouvé**.
- Des vols avec exfiltration vers le Costa Rica sont documentés (§4). **Recommandation : interdire la sortie du territoire et géofencer la zone frontalière (Chiriquí, Bocas)** (INFÉRÉ).

### 9.12 Unit economics par véhicule (hypothèses, Panamá City)

*Toutes les valeurs ci-dessous sont des hypothèses de travail (INFÉRÉ) sauf mention ; à remplacer par des données de mystery shopping, de l'assureur et du PSP.*

| Poste (par véhicule et par mois) | Hypothèse | Base |
|---|---|---|
| Prix moyen payé par jour (hors protection) | 45 $ | §1.4 (35–55 $ éco, 55–80 $ SUV) |
| Jours loués | 10 j (≈ 33 % d'utilisation) | INFÉRÉ |
| GMV location | **450 $** | calcul |
| Commission côté hôte | 22 % → 99 $ | TripWip 20–25 % (DOCUMENTÉ-SECONDAIRE) |
| Frais côté locataire | 10 % → 45 $ | INFÉRÉ |
| **Revenu plateforme** | **144 $** | calcul |
| Frais d'encaissement | ~3,5 % + 0,50 $/tx sur ~500 $ → ≈ 19 $ | PagueloFacil (DOCUMENTÉ-SECONDAIRE) |
| Versement à l'hôte | 1–3 $ | non trouvé (hypothèse) |
| Provision franchises impayées, fraude, chargebacks | 4 % du GMV → 18 $ | INFÉRÉ |
| Support et gestion des litiges (≈ 3 réservations) | 20 $ | INFÉRÉ |
| **Marge contributive hors assurance** | **≈ 85 $ (≈ 19 % du GMV)** | calcul |
| Assurance par jour loué | **non trouvée** ; test de sensibilité à 8–15 $/j | hypothèse |
| Si l'assurance est absorbée par la plateforme (10 $/j × 10 j) | **≈ −15 $** | calcul |

**Lecture** : le modèle n'est viable que si le coût d'assurance par jour est **facturé au locataire** (plan de protection) ou porté par l'hôte professionnel (polices flotte, modèle pro-first). Le coût d'assurance est la variable la plus sensible et il n'est pas documenté : c'est la première question à poser à l'assureur.

**Limites de ce modèle (corrigé VERIF_05-V5-05)** : (i) il décrit le **P2P de Phase 1** (commission hôte de 22 % calquée sur TripWip), pas la Phase 0 pro-first ; (ii) l'utilisation (33 % contre 27 % au Paraguay) est déduite de la demande, déjà notée ailleurs : le comparer entre pays compterait la demande deux fois ; (iii) les frais PSP sont ceux de PagueloFacil alors que l'architecture retenue passe par l'agence ou par un PSP licencié. **Ce modèle n'est donc plus utilisé dans la matrice (§10.2, poids 0 %).**

**Esquisse Phase 0 pro-first (hypothèses explicites, INFÉRÉ, non pondérée)** : prix moyen 45 $/j, 10 jours par mois et par véhicule listé **sur la plateforme** (part des réservations du loueur qui passe par nous, inconnue), commission loueur **12 %** (fourchette 10–20 %, à tester ; les OTA prélèvent typiquement 15–25 %, ordre de grandeur non sourcé ici), frais locataire 0–5 %. Si l'agence encaisse, la plateforme n'a ni frais PSP sur le loyer ni provision pour franchise impayée : revenu ≈ 54 $ par véhicule-mois (12 % × 450 $), moins support (≈ 10 $) et facturation/recouvrement de la commission (≈ 2 $) → **≈ 42 $ par véhicule-mois**. Le même calcul au Paraguay (35 $ × 8 j) donne ≈ 30 $. Ces chiffres ne servent qu'à fixer l'ordre de grandeur ; la seule donnée qui compte est le taux de commission accepté par les loueurs, **à obtenir par entretiens** (question OQ-MK-07, `22_OPEN_QUESTIONS.md`).

### 9.13 Risque politique et syndical

- Le **DE 10 du 16/04/2026** (plateformes VTC = « taxis de luxe »), soutenu par le gouvernement et **Canatra**, a été **abrogé le 20/04/2026** par le président Mulino après la protestation des chauffeurs de plateformes et une demande en nullité déposée par le député Ernesto Cedeño. DOCUMENTÉ-SECONDAIRE — https://www.laestrella.com.pa/panama/nacional/decreto-sobre-apps-de-transporte-abre-nueva-disputa-entre-conductores-estado-y-plataformas-DN21680416 ; https://www.panamaamerica.com.pa/sociedad/mulino-deroga-decreto-sobre-transporte-por-plataformas-digitales-y-abre-consulta-1260871
- **Aucune mobilisation** de taxis ou de loueurs contre la location P2P sans chauffeur n'a été trouvée (non trouvé). Lecture (INFÉRÉ) : le lobby du transport sait obtenir un décret en quelques jours ; une plateforme qui toucherait au segment VTC deviendrait une cible. Le modèle sans chauffeur, hors VTC, est moins exposé. Risque **moyen**.

---

## 10. Comparaison et recommandation de pays de lancement (Panama vs Paraguay)

*Section de décision commune aux fichiers 12 et 13 (le fichier 13 y renvoie, §10). Établie le 30/10/2026 après corrections VERIF_02, **révisée le 30/10/2026 après l'audit VERIF_05** (matrice reconstruite pour le modèle pro-first, critères éliminatoires notés avec le même niveau de preuve dans les deux pays, sensibilité élargie). Les critères éliminatoires sont évalués d'abord ; une note pondérée n'a de sens que si aucun critère éliminatoire n'est « NON ».*

### 10.1 Critères éliminatoires (go / no-go)

Légende : **OUI** = satisfait, sources à l'appui ; **PROBABLE** = aucun obstacle trouvé, mais non validé ; **NON VALIDÉ** = obstacle identifié ou question ouverte qui peut bloquer ; **NON** = bloquant. **Règle de preuve commune aux deux pays (corrigé VERIF_05-V5-02)** : un critère dont une condition bloquante de la Phase 0 reste ouverte ne peut pas être noté « OUI » ; un critère pour lequel un texte identifié pourrait s'appliquer est « NON VALIDÉ », pas « PROBABLE ».

| # | Critère éliminatoire | Panama | Paraguay | Robustesse |
|---|---|---|---|---|
| E1a | Légalité de la location **par des agences professionnelles** (plaques commerciales, activité déclarée) | **OUI** : loueurs nombreux sous Aviso de Operación (§1.5, §3.1) | **OUI** : loueurs établis (Localiza, Hertz, locaux), droit commun des contrats (13 §3.1) | Robuste |
| E1b | Légalité de la location **P2P par des particuliers avec plaques privées** (Phase 1) | **NON VALIDÉ** : la définition de la plaque « comercial » (reçoit un paiement) crée un risque de requalification ; décrets 17/1989 et 188/1990 non lus | **NON VALIDÉ** : zone grise, aucune interdiction trouvée ; risque de requalification de l'hôte en commerçant (IVA, RUC) | Dépend d'un avis juridique |
| E2a | Assurance pour le modèle **pro** distribué via la plateforme | **PROBABLE** : polices flotte des loueurs et assurance obligatoire de base (Ley 68/2016) ; **aucune police flotte lue** ; couverture d'une location distribuée par un tiers non vérifiée (condition 6) (corrigé VERIF_05-V5-06) | **PROBABLE** : loueurs assurés (TPL/CDW vendus au comptoir) ; aucune police lue ; **aucune assurance obligatoire** et 25–30 % du parc assuré, donc tiers souvent non indemnisables (13 §9.9) | Dépend des assureurs des loueurs (les deux pays) |
| E2b | Assureur partenaire avec un produit **P2P / par réservation** (Phase 1) | **NON VALIDÉ** : aucun produit P2P trouvé ; avenants « auto de alquiler » existants (Ancón, ASSA, MAPFRE) ; MAPFRE a une expérience P2P au Brésil | **NON VALIDÉ** : aucun produit trouvé ; aucun socle obligatoire ; référence régionale : TripWip assuré par un assureur par pays (Sancor en Uruguay, RUS en Argentine, AXA au Mexique) (corrigé VERIF_05-V5-11) | Dépend de l'assureur |
| E3 | Encaisser les paiements et **verser aux loueurs / hôtes** sans licence que nous n'avons pas | **PROBABLE** : rails disponibles (dLocal, Localpayment, ACH, PSP locaux avec Yappy) ; **qualification de casa de remesas (licence MICI, Ley 48/2003) ouverte, et bloquante pour la Phase 0 si la plateforme encaisse le loyer** ; Stripe Global Payouts conditionné à des MTL et à Treasury (corrigé VERIF_05-V5-01/V5-02) | **PROBABLE** : Bancard vPOS, dLocal (payouts PYG/USD) ; pas de Stripe Global Payouts ; **statut de PSP à qualifier** si la plateforme encaisse pour compte de tiers (Ley 7503, Résolution BCP n° 25, Acta 58, 18/12/2025, registre obligatoire) | Dépend d'un avis juridique **dans les deux pays** ; contournable en Phase 0 si l'agence encaisse elle-même |
| E4 | Pouvoir **constituer une société et exercer l'activité** (établissement juridique) | **NON VALIDÉ** : SA 100 % étrangère possible, **mais** l'art. 288 de la Constitution (texte consolidé ; « art. 293 » dans les annexes TLC) réserve le commerce de détail, défini comme « la venta al consumidor o a la **representación o agencia** de empresas productoras [o] mercantiles » ; une marketplace agent ou mandataire de loueurs peut y tomber ; aucune source ne tranche (§9.1) (corrigé VERIF_05-V5-03) | **OUI** : SA ou EAS (Ley 6480/2020) via SUACE, égalité de traitement des investisseurs étrangers et liberté des transferts (Ley 117/91) ; aucune réserve sectorielle trouvée ; SIFEN dès le premier jour | Panama : dépend d'un avis juridique (art. 288) ; Paraguay : robuste |
| E5 | Livraison ou remise à l'**aéroport** (Tocumen / ASU) | **NON VALIDÉ** : règles de concession et de livraison non trouvées (§9.7) ; repli : comptoirs des loueurs ou point hors emprise | **NON VALIDÉ** : idem (13 §9.7) | Non bloquant en Phase 0 si les remises se font aux agences des loueurs (ajout VERIF_05 §3) |

**Résultat** : aucun critère n'est « NON ». **Mais aucun des deux pays ne passe aujourd'hui tous les critères éliminatoires du modèle pro-first sans avis juridique** (corrigé VERIF_05 §3). Le Paraguay en passe davantage : E4 y est OUI, alors qu'au Panama E4 est NON VALIDÉ et E3 dépend de la qualification casa de remesas. Le P2P entre particuliers ne passe dans aucun des deux pays tant que E1b et E2b ne sont pas validés.

### 10.2 Critères pondérés (notes sur 5, 5 = très favorable), reconstruits pour la Phase 0 pro-first

Changements par rapport à la version précédente (corrigé VERIF_05-V5-04/V5-05/V5-07/V5-19) : (i) ajout de **« Établissement juridique / capacité à opérer »** (qui porte le risque art. 288 et casa de remesas au Panama, statut PSP au Paraguay ; il était auparavant hors pondération) ; (ii) ajout de **« Profondeur de l'offre pro »** (offre disponible pour un MVP de loueurs) ; (iii) **« Unit economics » ramené à 0 %** ; (iv) **« Concurrence »** évaluée face aux agrégateurs et OTA et aux sites des loueurs, et non plus face au P2P ; (v) **Paiements** limité aux rails et à l'acceptation (la question de licence passe dans « Établissement », pour ne pas la compter deux fois).

| Critère | Poids | Panama | Paraguay | Justification et sources |
|---|---|---|---|---|
| Demande | 25 % | **3,5** | **2,5** | PA : 2,24 M de visiteurs étrangers via Tocumen (ATP, CONFIRMÉ), 28 % nord-américains habitués à la location (l'habitude de Turo, INFÉRÉ, est retirée de la justification : elle concerne la Phase 1) (corrigé VERIF_05-V5-19) ; demande locale ≈ 50 % historiquement (ANAV 2014). PY : ≈ 0,64 M d'arrivées à ASU (dont des résidents), 2,03 M de touristes surtout argentins **venus en voiture** (13 §1.3). |
| Paiements (rails et acceptation) | 15 % | **3** | **2,5** | PA : USD sans risque de change, ACH Xpress, Yappy (≈ 1,4–1,6 M d'utilisateurs), dLocal, Localpayment ; cartes peu répandues (≈ 20 % carte de crédit), Clave mal acceptée par les PSP internationaux ; **Global Payouts sans objet en Phase 0** (ramené de 3,5, corrigé VERIF_05-V5-01). PY : écosystème QR très développé (64 % des paiements électroniques), plafonds de commissions (cartes 3 %/2 %, QR 1,5 %), dLocal ; mais PYG (change), cartes de crédit probablement rares, pas de Global Payouts. |
| Opérations | 15 % | **2** | **2** | PA : 53 132 accidents/an, routes non revêtues, vols de pick-ups, péages et amendes au propriétaire. PY : vols (1 à 3 voitures/jour fin 2025), exfiltration, motos non assurées. Égalité. En pro-first, ces risques sont portés d'abord par les loueurs. |
| Concurrence (pro-first) | 10 % | **2,5** | **3** | Concurrents directs d'une marketplace de loueurs : **agrégateurs et OTA** et sites propres des loueurs. PA : Kayak, Expedia, VIP Cars, Rentcars couvrent Tocumen, avec **24 à 27 enseignes** selon les pages d'agrégateurs (chiffres divergents) ; grands loueurs (Automarket, internationaux) déjà distribués et dotés de sites de réservation. PY : Kayak (**16 à 18 enseignes** à Asunción), Rentcars (ASU), VIP Cars ; marché plus petit et moins disputé. Présence de Booking.com Cars : **non vérifiée** dans les deux pays. Aucun P2P dans les deux pays (Phase 1). Notre valeur ajoutée face aux agrégateurs (prix « tout compris » avec TPL, paiement local Yappy/QR, confiance) **n'est pas démontrée**. DOCUMENTÉ-SECONDAIRE — https://www.kayak.com/Panama-City-Tocumen-Intl-Airport-Car-Rentals.PTY.cap.ksp ; https://www.vipcars.com/car-rental/panama/panama-city/tocumen-intl-airport ; https://www.kayak.com/Cheap-Asuncion-Car-Rentals.32233.cars.ksp ; https://www.rentcars.com/es-ar/airports/paraguay/asu-silvio-pettirossi-asuncion-asuncion ; https://www.rentcars.com/es-ar/company/automarket/panama/airports/pt2-panama-provincia-de-panama |
| **Profondeur de l'offre pro** (nouveau) | 15 % | **4** | **2,5** | PA : Automarket revendique **> 3 000 véhicules et 15 agences** (auto-déclaré, communiqué payé, 7/02/2025) ; une quinzaine d'enseignes internationales et des locaux (Ancón, Arrendadora Económica, Express, Panarental) ; 24–27 enseignes à Tocumen sur les agrégateurs ; historique ANAV : ≈ 10 000 véhicules et 28 entreprises (2014, daté). PY : Localiza (franchise DLS) **≈ 1 000 véhicules, 7 points** (Infonegocios, 29/09/2026) ; 16–18 enseignes sur Kayak, dont Autounion et Sixt (4 points chacun) ; « peu de loueurs » est une **contrainte d'offre** en pro-first, et non un avantage (corrigé VERIF_05-V5-04). DOCUMENTÉ-SECONDAIRE — Prensa (Automarket) ; https://infonegocios.com.py/y-ademas/localiza-celebra-20-anos-en-paraguay-y-proyecta-su-crecimiento-con-una-flota-de-1-000-vehiculos ; Kayak (idem) |
| **Établissement juridique / capacité à opérer** (nouveau) | 20 % | **2** | **3,5** | PA : art. 288 (définition « representación o agencia »), qualification casa de remesas si la plateforme encaisse, aucun avis obtenu ; contournements possibles mais non validés (§9.1). PY : EAS en ligne sans capital minimum, Ley 117/91, aucune réserve sectorielle trouvée ; **mais** statut PSP à qualifier si la plateforme encaisse (Résolution BCP n° 25 du 18/12/2025, registre obligatoire) : d'où 3,5 et non 4 (même règle de preuve qu'au Panama). CONFIRMÉ (textes) / À VALIDER (application). |
| Unit economics | **0 %** | (3) | (2,5) | **Retiré de la pondération** (corrigé VERIF_05-V5-05) : aucune donnée (tout est INFÉRÉ, coût d'assurance non trouvé) ; l'écart venait d'hypothèses d'utilisation déduites de la demande (double comptage) ; le modèle utilisait une commission P2P de 22 % alors que la Phase 0 est pro-first. Esquisse Phase 0 au §9.12 (≈ 42 $ contre ≈ 30 $ par véhicule-mois, INFÉRÉ). Réintroduction à 15 % testée en sensibilité : sans effet sur le classement. |
| **Note pondérée** | 100 % | **2,88** | **2,68** | Écart **+0,20** (contre +0,53 dans la version précédente). Calcul : PA = 0,25×3,5 + 0,15×3 + 0,15×2 + 0,10×2,5 + 0,15×4 + 0,20×2 = 2,875 ; PY = 0,25×2,5 + 0,15×2,5 + 0,15×2 + 0,10×3 + 0,15×2,5 + 0,20×3,5 = 2,675. |

**Analyse de sensibilité (recalcul par script, 30/10/2026 ; corrigé VERIF_05-V5-07)**

| Scénario | Panama | Paraguay | Écart |
|---|---|---|---|
| S0 base (poids ci-dessus) | 2,88 | 2,68 | +0,20 |
| S1 poids égaux (6 critères) | 2,83 | 2,67 | +0,17 |
| S2 avis favorable au Panama (Établissement PA = 4) | 3,28 | 2,68 | **+0,60** |
| S3 Établissement PA = 1,5 (avis réservé, montage lourd) | 2,78 | 2,68 | +0,10 |
| S4 statut PSP non requis au Paraguay (Établissement PY = 4) | 2,88 | 2,78 | +0,10 |
| S3 + S4 combinés | 2,78 | 2,78 | 0,00 (égalité) |
| S5 offre pro retirée (poids redistribués) | 2,68 | 2,71 | **−0,03 (inversion)** |
| S6 Demande 15 %, Établissement 30 % | 2,73 | 2,78 | **−0,05 (inversion)** |
| S7 défavorable (Dem 20, Pay 15, Ops 15, Conc 10, Offre 10, Établ. 30) | 2,70 | 2,78 | **−0,08 (inversion)** |
| S8 unit economics réintroduites à 15 % (PA 3 / PY 2,5) | 2,89 | 2,65 | +0,25 |
| Monte-Carlo, 100 000 jeux de poids aléatoires (Dirichlet), 6 critères | Panama gagne dans **68 %** des cas | | |
| Monte-Carlo, 5 critères sans « Établissement » | Panama gagne dans **96 %** des cas | | |

**Seuils d'inversion** : le Paraguay passe devant dès que le poids d'« Établissement » dépasse **29,5 %** (autres poids réduits proportionnellement) ou **25 %** (autres à poids égaux). **Lecture** : sans la question juridique, le Panama est nettement devant (96 % des jeux de poids), surtout grâce à la demande aérienne et à la profondeur de l'offre pro ; avec elle, l'avance est mince (+0,20) et **la recommandation dépend de l'avis sur l'art. 288 et la casa de remesas**. Un avis favorable porte l'écart à +0,60 ; un avis négatif sans montage viable rend E4 « NON » et sort le Panama de la comparaison, quelle que soit la pondération.

### 10.3 Recommandation : **GO CONDITIONNEL — Panama d'abord, sous réserve d'un avis juridique ; Paraguay en repli explicite**

(corrigé VERIF_05-V5-07 et §5)

**Décision** : lancer au **Panama (Panamá City)** en **pro-first**, **seulement si** un avis juridique court (avocat panaméen) conclut que : (a) le modèle retenu (plateforme étrangère facturant un service d'intermédiation **au loueur**, le loueur contractant et encaissant auprès du locataire) **ne relève pas** du commerce de détail réservé de l'art. 288, branche « representación o agencia » comprise, ou qu'un montage viable existe ; et (b) ce flux **n'est pas** une activité de casa de remesas (Ley 48/2003). **En parallèle**, commander un avis court au Paraguay sur le **statut PSP** (Résolution BCP n° 25 du 18/12/2025), pour que le repli soit prêt. Lire aussi les polices flotte de 2 ou 3 loueurs panaméens (condition 6).

**Règle de bascule** :
- Avis Panama **favorable** (a et b) → GO Panama ; Paraguay deuxième marché à 12–18 mois.
- Avis Panama **favorable sous montage** (associé panaméen, agence locale, PSP licencié encaisseur) → GO Panama si le coût et le délai du montage sont acceptables ; sinon traiter comme négatif.
- Avis Panama **négatif sans montage viable** (E4 = NON) → **bascule sur le Paraguay** en premier marché (EAS via SUACE, aucune réserve sectorielle trouvée), avec un flux de paiement compatible avec l'avis PSP. Le Panama est réexaminé plus tard (par exemple via un partenaire panaméen).
- Les deux avis négatifs sur l'encaissement (remesas et PSP) → Phase 0 en **« l'agence encaisse, la plateforme facture sa commission »** dans le pays où E4 est OUI.

**Modèle d'entrée** :
1. **Phase 0 (MVP)** : marketplace de **loueurs professionnels** (petits loueurs locaux, flottes de renting) qui ont déjà des plaques commerciales, un Aviso de Operación et une police flotte. **Flux de paiement privilégié : l'agence encaisse le loyer** (avec son PSP local, Yappy et Clave compris, et émet sa facture électronique au locataire), **la plateforme facture sa commission au loueur** ; à défaut, encaissement par un **PSP licencié** (dLocal, Localpayment). L'encaissement du loyer complet par l'entité US n'est retenu que si l'avis US (MTL) et l'avis panaméen (remesas) le permettent (corrigé VERIF_05-V5-20). Prix « tout compris » transparent. **Pas de segment VTC, pas de livraison en zone d'arrivée de l'aéroport tant qu'elle n'est pas autorisée, pas de sortie vers le Costa Rica.**
2. **Phase 1** : ouverture à des **hôtes particuliers vérifiés** (KYC, véhicule non financé ou consentement du prêteur, GPS pour pick-ups et 4x4), **seulement** après validation des conditions ci-dessous. Versements via dLocal ou Localpayment, ou via Stripe Global Payouts **si** la plateforme détient les licences requises.
3. **Phase 2** : segment VTC réservé aux flottes pros, moyenne durée pour expatriés (avec contrôle art. 110/111), puis Paraguay (si non déjà lancé).

**Conditions à valider avant le lancement** (aucune n'a été validée à ce jour ; questions détaillées en `22_OPEN_QUESTIONS.md`, OQ-MK-01 à OQ-MK-07) :

| Conseil | Condition | Bloque |
|---|---|---|
| **Avocat (PA)** | (1) Le modèle « agent ou mandataire des loueurs » (plateforme à capital étranger) n'est pas du « comercio al por menor » réservé par l'**art. 288** (texte consolidé ; « art. 293 » dans les annexes TLC), branche « representación o agencia » comprise — sinon montage viable (associé panaméen, opérateur étranger facturant le loueur) compatible avec la clause « interpuesta persona » | Phase 0 |
| Avocat (PA) | (2) Les flux de paiement (encaissement pour compte des loueurs, reversements, Stripe Global Payouts) ne sont pas une activité de **casa de remesas** (licence MICI, Ley 48/2003) | Phase 0 (si la plateforme encaisse) |
| **Avocat (US)** | (2 bis) L'entité US qui encaisserait le loyer pour compte de tiers a-t-elle besoin de **Money Transmitter Licenses** d'État, ou peut-elle invoquer l'exemption *agent of payee* ? Sinon, PSP licencié | Phase 0 (si l'entité US encaisse) |
| **Avocat (PY)** | (2 ter) Statut **PSP** au sens de la Ley 7503 et de la Résolution BCP n° 25 (18/12/2025) pour une plateforme qui encaisse ou n'encaisse pas pour compte des loueurs | Phase 0 du repli Paraguay |
| Avocat (PA) | (3) Un particulier peut louer un véhicule à **plaque particular** sans changer de catégorie ; statut des décrets 17/1989 et 188/1990 | Phase 1 |
| Avocat (PA) | (4) Traitement des conducteurs titulaires de visas spéciaux (**art. 111**, permis ATTT) et des touristes (art. 110) | Phase 0 (contrôle KYC) |
| **Assureur** | (5) Produit par réservation (RC élevée au-delà des minima, dommages, vol) pour véhicules de particuliers, approuvé par la **SSRP** ; coût par jour ; franchises et exigences GPS | Phase 1 |
| Assureur / loueurs | (6) Les polices flotte des loueurs partenaires couvrent une location distribuée via une plateforme | Phase 0 |
| **Expert-comptable** | (7) ITBMS sur la commission et sur le loyer ; effet du projet 30-26 ; facture électronique (SFEP/PAC) émise par l'agence au locataire ; retenue sur services payés à l'entité US (**12,5 % effectif** en droit interne ; 7,5 % seulement sous convention, aucune avec les États-Unis à notre connaissance) ; dividendes 10 % | Phase 0 |
| **Loueurs (entretiens)** | (8) Commission acceptée par les loueurs (10–20 % ?) et part de leurs réservations qu'ils confieraient à la plateforme face aux agrégateurs | Phase 0 (viabilité) |

### 10.4 Ce qui est robuste et ce qui ne l'est pas

- **Robuste** (sources primaires ou convergentes) : le Panama a un avantage sur la **demande touristique aérienne** (2,24 M de visiteurs via Tocumen contre ≈ 0,64 M d'arrivées à ASU, résidents compris) et sur la **profondeur de l'offre professionnelle** (Automarket > 3 000 véhicules auto-déclarés, 24–27 enseignes à Tocumen, contre ≈ 1 000 véhicules chez Localiza PY et 16–18 enseignes à Asunción) ; l'économie en USD simplifie les paiements ; le **modèle pro-first** est légal a priori dans les deux pays sous l'angle de la location (E1a) ; le **segment VTC en P2P** est à exclure (échecs HyreCar et Moobie).
- **Moins robuste qu'annoncé auparavant (conditionnel)** : l'avantage **Stripe Global Payouts** est réel sur la liste des pays (Panama oui, Paraguay non), mais il suppose des licences de transmission de fonds et Stripe Treasury, et il ne sert qu'en Phase 1 (versements à des particuliers). Il n'est plus présenté comme robuste (corrigé VERIF_05-V5-01).
- **Dépend de points juridiques non validés** : la **réserve du commerce de détail** (art. 288) au Panama, qui peut à elle seule inverser le classement ou exclure le Panama ; la qualification **casa de remesas** (Panama) ou **PSP** (Paraguay) ; la couverture des **polices flotte** pour une distribution via plateforme ; la **légalité du P2P** entre particuliers et l'existence d'un **produit d'assurance P2P** (les deux pays, Phase 1).
- **Non démontré** : la valeur ajoutée d'une marketplace de loueurs face aux agrégateurs (Kayak, Rentcars, Expedia) et aux sites des loueurs ; le taux de commission que les loueurs accepteraient. **Non sourcé** : unit economics (retirées de la pondération).
- **Écart pondéré** : 2,88 contre 2,68 (+0,20). Il est porté par la demande et l'offre pro ; il s'inverse si le critère « Établissement » pèse plus de 25–30 %, ou si l'offre pro est ignorée. La recommandation est donc un **GO CONDITIONNEL** qui dépend d'un seul avis juridique, et elle doit être présentée comme telle.
