# 13 — PARAGUAY : étude de marché pour une marketplace de location de voitures P2P + professionnelle

> Rédigé le 2026-10-30. Recherche documentaire uniquement (WebSearch / WebFetch). Aucun contact pris, aucun formulaire soumis.
>
> **Légende des tags**
> - **CONFIRMÉ** : source primaire/officielle (BACN/leyes, DNIT, BCP, Poder Judicial/DRA, DINAC, SENATUR, Migraciones, IP Paraguay).
> - **DOCUMENTÉ-SECONDAIRE** : presse reconnue (ABC Color, Última Hora, La Nación, Infonegocios, Hoy), cabinets d'avocats, agrégateurs.
> - **INFÉRÉ** : déduction de l'analyste à partir de plusieurs données.
> - **À VALIDER** : à confirmer par un avocat, un assureur ou un expert-comptable local, ou par la source primaire.
>
> **Avertissement méthodologique** : beaucoup de pages de presse paraguayenne (Última Hora notamment) et du Poder Judicial affichent dans leurs métadonnées une date de crawl de 2026 et non la date de publication. Les dates données ci-dessous sont celles du contenu quand elles sont identifiables ; sinon, la mention « date à vérifier » est ajoutée.

---

## Synthèse

- Petit marché (≈ 6,1–6,4 M d'habitants, INFÉRÉ), mais **parc dynamique** : ≈ 3,1 M de véhicules immatriculés fin oct. 2024, dont environ 37 % de motos. Le marché du neuf préfère nettement les **SUV et les pick-ups**.
- **Demande de location en hausse** : record à l'aéroport ASU en 2025 (≈ 1,29 M de passagers **embarqués + débarqués**, soit ≈ 0,64 M d'arrivées, dont des résidents, corrigé VERIF_02-PY-07), 3,66 M de visiteurs internationaux en 2025 (80 % d'Argentins ; hausse de +91 % probablement liée à un changement de méthode ; base de demande retenue : ≈ 2,03 M de touristes avec nuitée, surtout venus par la route, corrigé VERIF_02-PY-06), immigration record (Brésiliens en tête), ≈ 30 000 chauffeurs VTC (segment exclu du MVP, voir §1.5).
- **Paiements** : écosystème local solide (Bancard, QR interopérable à 64 % des paiements électroniques, 7,6 M de comptes de portefeuille électronique). En revanche, **Stripe n'est pas disponible** (CONFIRMÉ) et **Stripe Global Payouts ne dessert pas le Paraguay** (contrairement au Panama, corrigé VERIF_02-X-01). La Ley 7503/2025 est **désormais réglementée** : règlement des prestataires de services de paiement (PSP, déc. 2025), règlement des rôles (13/07/2026), règlement tarifaire (plafonds QR et transferts à 1,5 %, juillet 2026) (corrigé VERIF_02-PY-03).
- **Réglementation** : **aucun cadre spécifique** à la location sans chauffeur ni au car-sharing P2P n'a été trouvé (zone grise). **Pas d'assurance auto obligatoire en vigueur** : la loi 4950/2013 (SOAT) a été suspendue puis abrogée, et seulement 25–30 % du parc est assuré. Une nouvelle loi sur les données personnelles (Ley 7593/2025) a été promulguée. La facturation électronique SIFEN devient progressivement obligatoire.
- **Opérations** : vol de véhicules significatif (exfiltration via Chili/Brésil/Bolivie), sinistralité routière élevée (3–4 morts/jour, majorité de motards), routes non pavées dans le Chaco, passage des frontières soumis à autorisation.
- **Concurrence P2P locale** : **aucun acteur P2P identifié** au Paraguay. Les loueurs traditionnels (Localiza — franchise DLS Rent A Car, ≈ 1 000 véhicules, 7 points —, Hertz, Alamo/National/Enterprise, Thrifty, Sixt, locaux) sont présents. Le voisin TripWip (Uruguay/Argentine) est une menace d'entrée crédible.

---

## 1. Parc automobile et demande

### 1.1 Parc et typologie des véhicules

| Donnée | Valeur | Tag | Source (date) |
|---|---|---|---|
| Véhicules immatriculés (DRA, cumul) | **3 105 755** au 31/10/2024 | CONFIRMÉ (Poder Judicial / Dirección de Registro de Automotores) | https://www.pj.gov.py/notas/27134-registro-de-automotores-con-3105755-matriculados (nov. 2024) |
| Composition | ≈ 60 % automobiles / ≈ 37 % motos (sept. 2024 : 3 090 506 véhicules) | CONFIRMÉ | https://www.pj.gov.py/notas/26882-registro-de-automotores-con-3090506-matriculados |
| Croissance | 2 540 294 fin 2020 → 3,1 M fin 2024 (≈ +5 %/an) | CONFIRMÉ + INFÉRÉ (calcul) | https://www.pj.gov.py/notas/19700-automotores-cerro-el-ano-con-mas-de-2540000-vehiculos-matriculados |
| Remarque | Il s'agit d'un **cumul d'immatriculations** qui inclut probablement des véhicules hors circulation. Le parc actif est donc inférieur. | INFÉRÉ / À VALIDER | — |
| Véhicules légers neufs 2025 | **38 611 unités (+11,2 %)** | DOCUMENTÉ-SECONDAIRE | https://bestsellingcarsblog.com/market/paraguay/ (2026) |
| Importations de neufs 2025 (CADAM) | SUV **22 326 (57,8 %, +20,8 %)** ; pick-ups **9 179 (23,8 %)** ; hybrides/électriques **4 049 (10,5 %, +65,7 %)** | DOCUMENTÉ-SECONDAIRE (données CADAM via presse) | https://infonegocios.com.py/y-ademas/mercado-automotor-acelera-proyectan-hasta-10-mas-importaciones-y-tercer-ano-de-recuperacion |
| Top modèles 2025 | Toyota Hilux, Chevrolet S10, Fiat Strada | DOCUMENTÉ-SECONDAIRE | bestsellingcarsblog (idem) |
| Occasions importées | Le Paraguay importe beaucoup de véhicules d'occasion via le Chili (surnommés « chileré », souvent d'origine japonaise ou asiatique et à conduite à droite convertie). Le Brésil aurait demandé l'arrêt de ces importations dans le cadre des négociations sur l'automobile. | DOCUMENTÉ-SECONDAIRE | https://www.ultimahora.com/cadam-autos-usados-tenemos-que-dejar-ser-el-basurero-del-mundo-n2829808.html (date à vérifier) ; https://www.abc.com.py/nacionales/2021/09/13/los-seis-modelos-de-vehiculos-chilere-mas-robados-en-paraguay/ (2021) |

**Implications produit (INFÉRÉ)** : l'offre P2P sera hétérogène (« chileré » anciens, pick-ups de travail, SUV récents). Il faudra des **critères d'éligibilité stricts** : âge du véhicule, origine, inspection technique (Ley 4856 / ITV municipale), titre au DRA sans nantissement (*prenda*). Les pick-ups 4x4 constituent une catégorie premium naturelle pour l'agro et le Chaco.

### 1.2 Pôles de demande géographiques

- **Gran Asunción** (Asunción + département Central) : principal bassin de population et d'affaires. C'est aussi là que se concentrent les vols de véhicules selon la Police (ABC 2023). INFÉRÉ / DOCUMENTÉ-SECONDAIRE : https://www.abc.com.py/policiales/2023/04/22/unos-cinco-vehiculos-son-robados-por-dia-en-paraguay/
- **Ciudad del Este (CDE)** : tourisme d'achat transfrontalier (Brésil/Argentine, Triple Frontière). La clientèle arrive majoritairement par la route ; la demande de location locale est réelle mais mêle risques de vol et de sortie illégale vers le Brésil. INFÉRÉ. La Police touristique de CDE a recensé 66 vols de véhicules de résidents paraguayens à Foz do Iguaçu en 2023 (≈ 5/semaine en fin d'année). DOCUMENTÉ-SECONDAIRE : https://www.lanacion.com.py/pais/2023/12/09/policia-turistica-reporto-66-robos-de-rodados-en-foz-de-residentes-en-el-este
- **Encarnación** : tourisme balnéaire et argentin (pont avec Posadas). L'aéroport Teniente Amín Ayub est devenu international de façon permanente et des vols directs vers Buenos Aires ont été annoncés. DOCUMENTÉ-SECONDAIRE (via résultats aviacionline/La Nación 2025). Uber y opère. https://www.ultimahora.com/uber-ya-hace-viajes-encarnacion-n2793593 (date à vérifier)
- **Chaco (Boquerón, Filadelfia/Loma Plata, Mcal. Estigarribia)** : déplacements agro et élevage, colonies mennonites, corridor bioocéanique en construction. Besoin de pick-ups 4x4. INFÉRÉ.

### 1.3 Aérien et tourisme

| Donnée | Valeur | Tag | Source |
|---|---|---|---|
| Aéroport Silvio Pettirossi (ASU) 2025 | **1 285 623 passagers au 20/12/2025**, record historique (au-dessus de 2019). Ce chiffre compte **embarquements et débarquements** : ≈ **0,64 M d'arrivées**, dont une part de résidents paraguayens. Le TAM de location aéroportuaire est donc environ deux fois plus faible que ce que suggère le total ; statistiques mensuelles d'arrivées internationales DINAC **non trouvées** (corrigé VERIF_02-PY-07) | DOCUMENTÉ-SECONDAIRE (données DINAC citées) | https://www.ultimahora.com/mas-de-1-2-millones-de-pasajeros-en-2025-el-aeropuerto-silvio-pettirossi-supera-su-record-historico ; https://prensamercosur.org/2025/12/25/paraguay-alcanza-record-historico-de-pasajeros-en-en-aeropuerto-silvio-pettirossi-durante-el-2025/ (25/12/2025) |
| Capacité ASU | ≈ 1,5 M pax/an (plafond), rénovations visant ≈ 2 M | DOCUMENTÉ-SECONDAIRE | idem + https://www.ultimahora.com/dinac-anuncia-reformas-y-mejoras-edilicias-en-el-aeropuerto-silvio-pettirossi |
| 2026 | Janvier, mars et avril 2026 en hausse de +14 % à +19 % sur un an | DOCUMENTÉ-SECONDAIRE | idem |
| Aéroport Guaraní (AGT, CDE) | Trafic marginal : ≈ 7 722 pax en 2024 et 3 402 en 2025 selon Wikipedia (donnée douteuse) ; quelques fréquences ASU–AGT seulement | DOCUMENTÉ-SECONDAIRE / À VALIDER | https://en.wikipedia.org/wiki/Guaran%C3%AD_International_Airport ; https://www.lanacion.com.py/negocios/2023/08/09/aeropuerto-guarani-cumple-30-anos-y-recibe-certificacion-de-sostenible |
| Visiteurs internationaux 2025 (SENATUR) | **3 657 194** (2 029 678 touristes + 1 627 516 excursionnistes sans nuitée), recettes **USD 1 422 M**, plus haut niveau depuis 2015. **Mise en garde** : la SENATUR annonce **+91,24 % sur un an**, hausse qui signale très probablement un changement de méthode (comptage des excursionnistes frontaliers). Base de demande retenue : **≈ 2,03 M de touristes**, majoritairement argentins venus par la route (corrigé VERIF_02-PY-06) | DOCUMENTÉ-SECONDAIRE (chiffres SENATUR via EFE/La Nación) | https://www.lanacion.com.py/negocios/2026/01/28/paraguay-recibio-mas-de-36-millones-de-visitantes-y-genero-usd-1422-millones-en-2025/ (28/01/2026) ; https://www.swissinfo.ch/spa/paraguay-recibi%c3%b3-m%c3%a1s-de-3%2c6-millones-de-visitantes-internacionales-en-2025/90852735 |
| Origine | **79,98 % Argentine**, 10,14 % Brésil, 1,09 % États-Unis | DOCUMENTÉ-SECONDAIRE | idem |
| Tourisme de réunions (MICE) | ≈ USD 500 M | DOCUMENTÉ-SECONDAIRE | https://www.lanacion.com.py/negocios/2025/12/23/usd-500-millones-el-turismo-de-reuniones-consolida-su-peso-en-la-economia-paraguaya/ (23/12/2025) |
| Objectif officiel | Passer de 2 M à 10 M de touristes d'ici 2037 (stratégie appuyée par le PNUD) | DOCUMENTÉ-SECONDAIRE / CONFIRMÉ (IP) | https://www.ip.gov.py/ip/2026/06/03/pnud-acompanara-estrategia-para-quintuplicar-la-llegada-de-turistas-a-paraguay/ (03/06/2026) |

**INFÉRÉ** : les Argentins, majoritaires, viennent surtout **en voiture** (achats, Encarnación, CDE), ce qui limite leur besoin de location. Les cibles naturelles sont donc plutôt les **voyageurs aériens à ASU** (affaires, MICE, diaspora, Brésiliens), les **expatriés** et les **usagers locaux**.

### 1.4 Expatriés et immigration

- **CONFIRMÉ pour l'annonce officielle (IP Paraguay, agence de presse de l'État ; la source statistique primaire est Migraciones, non consultée)** (corrigé VERIF_02-PY-09) : forte hausse des arrivées et des demandes de résidence au 1er semestre 2025. https://www.ip.gov.py/ip/2025/07/21/arribos-y-solicitudes-de-residencia-con-notable-incremento-en-el-primer-semestre-de-2025/ (21/07/2025)
- **DOCUMENTÉ-SECONDAIRE** : 47 687 demandes de résidence en 2025 (+63 %), dont 34 875 temporaires et 12 812 permanentes ; record historique (La Nación, 27/01/2026). https://www.lanacion.com.py/negocios/2026/01/27/sistema-tributario-y-calidad-de-vida-empujan-record-de-residencias-en-paraguay/
- 1er semestre 2026 : **29 765 résidences accordées (+81 %)**. https://www.imidaily.com/intelligence/paraguay-granted-29765-residencies-in-the-first-half-of-2026-up-81/ — DOCUMENTÉ-SECONDAIRE
- En 2024, 60 % des 28 000 résidences accordées l'ont été à des **Brésiliens**. https://www.lanacion.com.py/pais/2025/01/28/migraciones-de-las-28-mil-residencias-otorgadas-en-2024-el-60-es-de-brasilenos/ — DOCUMENTÉ-SECONDAIRE
- Durcissement en 2026 : la résolution 407 exige une preuve de solvabilité. DOCUMENTÉ-SECONDAIRE. https://www.lapoliticaonline.com/paraguay/politica-py/migraciones-busca-ordenar-alusion-de-extranjeros-y-endurece-controles-para-obtener-la-residencia-7759/
- Les chiffres varient selon les sources (résidences permanentes 2025 : de 4 623 à 10 624). **À VALIDER** sur migraciones.gov.py.

**INFÉRÉ** : segment intéressant pour la location moyenne durée (1 à 3 mois pendant l'installation, avant achat ou immatriculation), avec un besoin d'**interface en portugais et en anglais**.

### 1.5 Chauffeurs VTC (Bolt, Uber, MUV)

- Bolt est arrivé en novembre 2020 (DOCUMENTÉ-SECONDAIRE, La Nación, retagué, corrigé VERIF_02-PY-08 : https://www.lanacion.com.py/pais/2020/11/17/bolt-llego-a-paraguay-para-brindar-servicio-de-transporte-premium) ; Uber en décembre 2018 (https://en.mercopress.com/2018/12/13/uber-lands-in-paraguay-starts-taking-applications-from-would-be-drivers) ; MUV est l'application locale. DOCUMENTÉ-SECONDAIRE.
- **≈ 30 000 chauffeurs inscrits**, dont ≈ 10 000 à plein temps (Fédération paraguayenne des chauffeurs de plateformes). Bolt revendique ≈ 15 000 chauffeurs (+35 %). Date à vérifier. DOCUMENTÉ-SECONDAIRE. https://infonegocios.com.py/nota-principal/plataformas-el-nuevo-segundo-sueldo-para-miles-de-paraguayos-20-000-choferes-ya-generan-ingresos-extra
- Insécurité : un titre d'Última Hora fait état de 17 chauffeurs Bolt assassinés (date à vérifier). Mobilisations de chauffeurs Bolt en avril 2026. DOCUMENTÉ-SECONDAIRE. https://www.ultimahora.com/alarmante-inseguridad-suman-17-los-conductores-de-bolt-que-fueron-asesinados-en-paraguay ; https://www.abc.com.py/nacionales/2026/04/08/bolt-se-pronuncia-tras-movilizacion-de-conductores-y-pide-dialogo-directo/
- **Aucun acteur structuré de location pour chauffeurs VTC** (type Kovi) n'a été identifié au Paraguay. Ce vide n'est **pas une opportunité pour le MVP** : c'est le segment qui a fait échouer **HyreCar** (Getaround US, liquidé en 2025 faute de liquidité) et **Moobie** (Brésil, P2P + VTC, opérations suspendues), pour des raisons qui s'appliquent ici avec plus de force (kilométrage intensif, sinistralité, impayés, fraude, insécurité des chauffeurs, vol). Les gagnants régionaux du segment (Kovi/Moove, Localiza Zarp) sont des **flottes contrôlées**, pas du P2P. **Recommandation atténuée** : exclure le VTC du MVP et du P2P entre particuliers ; envisager plus tard une offre réservée à des **flottes professionnelles** (leasing, assurance flotte, caution, GPS avec coupure moteur) (corrigé VERIF_02-C-06). INFÉRÉ.

### 1.6 Loueurs existants et prix

- **Localiza** : franchise exclusive opérée par **DLS Rent A Car SA** (Grupo De La Sobera) depuis 20 ans ; **≈ 1 000 véhicules** et **7 points** (siège avenue Aviadores del Chaco, aéroport ASU, Ciudad del Este, Encarnación, San Lorenzo, Coronel Oviedo, Pedro Juan Caballero) ; se présente comme leader du renting d'entreprise. Le chiffre « 13 agences selon KAYAK » (points de retrait d'agrégateur) est **retiré** (corrigé VERIF_02-PY-11). DOCUMENTÉ-SECONDAIRE — Infonegocios, 29/09/2026 : https://infonegocios.com.py/y-ademas/localiza-celebra-20-anos-en-paraguay-y-proyecta-su-crecimiento-con-una-flota-de-1-000-vehiculos
- Présents à ASU et/ou en ville d'après les agrégateurs : **Hertz, Alamo, National/Enterprise, Thrifty, Sixt, Autounion Car Rental, Street Rent a Car, Ace**. DOCUMENTÉ-SECONDAIRE. https://www.es.kayak.com/Paraguay-Alquiler-de-autos.192.crc.html ; https://www.vipcars.com/es/car-rental/paraguay/asuncion/asuncion-airport ; https://nationalcar.com/es/alquiler-vehiculos/oficinas/py/aeropuerto-internacional-silvio-pettirossi-de-asuncion-kc03.html
- Avis/Budget : présence non confirmée par cette recherche. À VALIDER.
- **Prix journaliers observés (agrégateurs, oct. 2026)** : économique en ville dès **USD 15–23/jour** ; ASU dès USD 18–27/jour ; **moyenne ≈ USD 32–46/jour** (KAYAK, Skyscanner). Âge minimum habituel : **21 ans**. DOCUMENTÉ-SECONDAIRE. https://www.es.kayak.com/Aeropuerto-Asuncion-Silvio-Pettirossi-alquiler-autos.ASU.cap.ksp ; https://espanol.skyscanner.com/renta-de-autos-en/renta-de-autos-en-asuncion/27548165.html
- **INFÉRÉ** : un pick-up 4x4 ou un SUV se loue probablement **USD 60–120/jour**. À VALIDER par un relevé de prix ciblé.
- **P2P au Paraguay** : **aucune plateforme identifiée** (recherche sans résultat ; TripWip opère en Uruguay, Argentine et Mexique, pas au Paraguay). DOCUMENTÉ-SECONDAIRE / À VALIDER. Le canal informel (Facebook Marketplace, WhatsApp, « alquilo auto para Bolt ») existe probablement (INFÉRÉ).

---

## 2. Paiements

| Thème | Constat | Tag | Source |
|---|---|---|---|
| Bancarisation | **81 % de la population en âge de travailler** bancarisée (BCP, avril 2025) | DOCUMENTÉ-SECONDAIRE (donnée BCP) | https://infonegocios.com.py/plus/paraguay-avanza-en-bancarizacion-8-de-cada-10-adultos-ya-tienen-una-cuenta-el-credito-sera-el-proximo-paso |
| Paiements numériques (Findex) | **55 % des adultes** utilisaient des paiements numériques en 2024 (doublement depuis 2021) | DOCUMENTÉ-SECONDAIRE (Banque mondiale via La Nación) | https://www.lanacion.com.py/negocios/2025/07/23/paraguay-duplica-la-inclusion-financiera-digital-y-se-corona-campeon-findex-segun-banco-mundial/ (23/07/2025) |
| Portefeuilles électroniques | **> 7,6 M de comptes** (77 % actifs) en déc. 2025. Tigo Money est historiquement dominant (≈ 72 % du marché selon un article plus ancien). Billetera Personal, Zimple, Wally, etc. | DOCUMENTÉ-SECONDAIRE | https://www.lanacion.com.py/negocios_edicion_impresa/2026/03/14/inclusion-financiera-avanza-pero-aun-enfrenta-retos-en-ahorro-e-inversion/ ; https://dplnews.com/?p=219854 |
| Cartes de crédit | Taux de détention de cartes de crédit **non trouvé**. Probablement faible (< 20–25 % des adultes, INFÉRÉ) | À VALIDER (BCP / EIF) | — |
| QR (Bancard) | Le QR représente **64 % des paiements électroniques** (déc. 2025) contre 31,5 % pour la carte physique et 4,5 % pour les portefeuilles. Réseau de 120 000 commerces et 3 M d'utilisateurs, interopérable avec plus de 75 applications. Ticket moyen QR ≈ **PYG 110 000**. Record de 25 M de transactions QR en août 2026 (+53 %) | DOCUMENTÉ-SECONDAIRE (rapports Bancard) | https://www.lanacion.com.py/negocios/2025/12/22/en-paraguay-7-de-cada-10-pagos-se-realizan-con-el-celular/ ; https://infonegocios.com.py/amp/conosur/pagos-digitales-en-alza-el-qr-alcanzo-un-record-de-25-millones-de-transacciones-en-agosto |
| Acquéreurs / processeurs | **Bancard** (réseau dominant ; passerelle e-commerce **vPOS**), **Bepsa** (réseau concurrent, À VALIDER), **Infonet** (réseau de bancs/ATM), **Pagopar** (rebaptisé *upay*, agrégateur cartes + QR + abonnements), Tigo Money, Billetera Personal, Zimple | DOCUMENTÉ-SECONDAIRE | https://yo-facturo.com/blog/pagopar-que-es-como-cobrar-online/ ; https://support.wix.com/en/article/connecting-pagopar-as-a-payment-provider |
| Plafonds de commissions (BCP) | Résolution BCP du 13/03/2025 : depuis le **1/07/2026**, plafond **crédit 4 % → 3 %**, **débit 3 % → 2 %** (deuxième et dernière étape) | CONFIRMÉ (annonce officielle relayée par l'agence IP, 29/06/2026 — https://www.ip.gov.py/ip/2026/06/29/bcp-implementara-desde-el-1-de-julio-una-reduccion-gradual-de-las-comisiones-por-pagos-con-tarjetas-de-credito-y-debito/) / DOCUMENTÉ-SECONDAIRE (Ferrere) | https://ferrere.com/en/news/paraguay-moderniza-su-sistema-de-pagos-rigen-nuevos-topes-para-comisiones-de-tarjetas/ ; https://www.hoy.com.py/negocios/2026/06/29/pagos-con-tarjetas-entra-en-vigor-nueva-reduccion-de-comisiones |
| Loi système de paiements | **Ley N° 7503/2025** : cadre du Système national de paiements (autorité BCP), transferts simples gratuits. Date de promulgation : **27/06/2025** selon Ferrere et le BCP, **2/07/2025** selon La Nación (divergence non résolue) | DOCUMENTÉ-SECONDAIRE (Ferrere, La Nación) / À VALIDER (BACN) | https://ferrere.com/es/novedades/nueva-ley-del-sistema-nacional-de-pagos-en-paraguay/ ; https://www.lanacion.com.py/politica/2025/06/28/ejecutivo-promulga-ley-de-sistema-nacional-de-pagos/ |
| **Réglementation de la Ley 7503 (désormais adoptée)** | (i) **Résolution n° 25, Acta n° 58 du 18/12/2025** (communiqué BCP du 22/12/2025) : « Reglamento de Definición de Roles, Registro, Transparencia Informativa y Seguridad de la Información para PSP » — rôles, obligations, sécurité et **registre obligatoire des PSP auprès du BCP** ; lignes directrices d'enregistrement confiées à la Gerencia General (règlement opératoire d'enregistrement listé sur la page des résolutions du BCP : Résolution G.G. n° 71 du 08/06/2026, non lue) ; officialisation par décret de l'Exécutif rapportée par Última Hora (26/07/2026, numéro du décret non trouvé) (corrigé VERIF_05-V5-10) ; (ii) **13/07/2026** (acte n° 31) : règlement définissant les **rôles fonctionnels** des PSP ; (iii) **juillet 2026** : **règlement tarifaire** — plafond de **1,5 % TTC** pour les paiements **QR** par virement, l'initiation de paiement (PISP), les demandes de paiement, les prélèvements et les virements sur systèmes propriétaires ; 1 % (max. ₲ 5 500) pour le participant parrain ; plafonds aussi pour SIPAP, l'acquisition et le traitement de cartes (montants non relevés) ; consultation sur l'interopérabilité des cartes. **Conséquence** : une plateforme qui encaisse pour compte des hôtes pourrait devoir **s'enregistrer comme PSP** ou passer par un PSP enregistré (délais d'adaptation non trouvés ; **date d'entrée en vigueur des plafonds tarifaires de juillet 2026 non trouvée**, l'annonce étant confirmée par Hoy le 15/07/2026) (corrigé VERIF_02-PY-03 ; corrigé VERIF_05-V5-10) | CONFIRMÉ (communiqués BCP, page lue via résultats ; accès direct refusé en 403) / DOCUMENTÉ-SECONDAIRE (Hoy, Última Hora) | https://www.bcp.gov.py/web/institucional/w/el-bcp-aprueba-nuevo-reglamento-para-proveedores-de-servicios-de-pago-en-el-sistema-nacional-de-pagos ; https://www.bcp.gov.py/web/institucional/w/bcp-establece-reglamento-tarifario-para-fortalecer-transparencia-y-competencia-en-sistema-nacional-de-pagos ; https://www.hoy.com.py/nacionales/2026/07/15/bcp-fija-topes-a-comisiones-de-pagos-con-qr-y-otros-servicios ; https://www.ultimahora.com/como-son-los-roles-en-el-sistema-de-pagos-tras-la-regulacion-del-bcp |
| SIPAP / virements instantanés | SIPAP (système de paiements du BCP) permet des virements interbancaires quasi instantanés. Fonctions QR/NFC de transfert ouvertes par le BCP en mars 2026 | DOCUMENTÉ-SECONDAIRE / À VALIDER (données SIPAP non trouvées) | https://www.lanacion.com.py/negocios/2026/03/16/bcp-libera-funciones-para-transferir-dinero-via-qr-y-nfc/ |
| Brésiliens | Partenariat Bancard–PagBrasil pour des paiements **Pix** de touristes paraguayens au Brésil (l'inverse, l'acceptation de Pix au Paraguay, est À VALIDER) | DOCUMENTÉ-SECONDAIRE | https://thepaypers.com/payments/news/bancard-and-pagbrasil-to-offer-pix-payments-to-paraguayan-tourists |
| **Stripe** | **Non disponible pour les entités paraguayennes** (en LATAM, seuls le Brésil et le Mexique figurent). Une entité étrangère (ex. LLC US) peut encaisser des cartes internationales | **CONFIRMÉ** (retagué, corrigé VERIF_02-X-01) | https://stripe.com/global |
| **Stripe Global Payouts** | **Paraguay : À VALIDER** (reporté 09b §8 ; corrigé VERIF_08-V8-04). Le changelog Stripe du **27/05/2026** ajoute `py_bank_account` (Paraguay) parmi 20 nouvelles destinations (API `2026-05-27.preview`), mais la page « Supported recipient countries » relue le **30/10/2026** ne liste pas le Paraguay. Disponibilité réelle, devise (PYG / USD) et délais non confirmés (OQ-PAY-20). Mêmes réserves qu'au Panama : licences MTL de la plateforme, Stripe Treasury, solde détenu par la plateforme. **En attendant, les versements aux hôtes paraguayens passent par dLocal, un autre PSP local ou un compte local de l'entité (SIPAP)** ; Stripe n'est qu'un rail secondaire possible de la Phase 1, à valider | CONFIRMÉ (changelog et liste lus le 30/10/2026, contradictoires entre eux) / **À VALIDER** (disponibilité) | https://docs.stripe.com/changelog/dahlia/2026-05-27/cross-border-payouts-20-new-bank-account-types.md ; https://docs.stripe.com/global-payouts/send-money/recipient-countries |
| **Localpayment** | Pas de pay-in au Paraguay ; **payouts SIPAP en PYG en temps réel** (rail standard 1–5 M PYG, rail haute valeur au-delà), depuis un solde préfinancé. **Statut** : au Paraguay, simple **sujet obligé LBC enregistré auprès de la SEPRELAD**, **pas de licence de paiement** ; au Panama, enregistrement SBP au titre de la LBC (code MP-012), pas une licence non plus (reporté 09b §8 ; corrigé VERIF_08-V8-05) | CONFIRMÉ (page licences de l'éditeur, docs payouts ; 09b §3.4) | https://localpayment.com/licenses.php ; https://docs.localpayment.com/docs/payouts-overview |
| **dLocal** | Couvre le Paraguay (cartes locales et méthodes alternatives) ; partenaire de PayPal en entreprise | DOCUMENTÉ-SECONDAIRE (doc dLocal) | https://docs.dlocal.com/docs/paraguay ; https://thepaypers.com/online-payments/paypal-and-dlocal-extend-payment-access-in-emerging-markets--1273457 |
| **PayPal** | Utilisable pour payer ; **retraits vers des banques locales limités ou incertains** | À VALIDER | — |
| Monnaie | **Guaraní (PYG), sans sous-unité** (code ISO 4217 avec 0 décimale). Montants élevés : un ticket moyen QR de PYG 110 000 vaut ≈ USD 14–15 au taux INFÉRÉ ≈ 7 300–8 000 PYG/USD. L'**USD** est courant pour les biens durables, l'immobilier et les véhicules | CONFIRMÉ (ISO) / INFÉRÉ (taux, À VALIDER BCP) | — |

**Paiements aux particuliers (payouts aux propriétaires)** — INFÉRÉ / À VALIDER : versement en PYG par virement bancaire (SIPAP) ou vers un portefeuille électronique (Tigo Money, Personal) via un PSP local ou dLocal Payouts (PYG ou USD, CONFIRMÉ doc dLocal). **Stripe Global Payouts n'est pas une option confirmée** : Paraguay ajouté par le changelog du 27/05/2026 mais absent de la liste des pays au 30/10/2026, **À VALIDER** (OQ-PAY-20 ; reporté 09b §8 ; corrigé VERIF_08-V8-04, précise VERIF_02-X-01). Localpayment verse en SIPAP mais n'est qu'un sujet obligé LBC enregistré (SEPRELAD), sans licence de paiement (corrigé VERIF_08-V8-05). Aucune API publique de versement en masse de Tigo Money n'a été trouvée (voir §9.3). Un paiement en USD sur compte local est possible mais complexe. Côté fiscal, voir §3.8 : le propriétaire est potentiellement contribuable IRP/IVA et la plateforme pourrait devenir agent de retenue.

**Fraude et rétrofacturations (chargebacks)** — INFÉRÉ : pas de données publiques trouvées. Risques typiques : cartes volées sur vPOS, *friendly fraud*, contestations de franchise dommages. Atténuations : **pré-autorisation de caution** (la faisabilité sur cartes de débit locales est À VALIDER avec Bancard), 3-D Secure, KYC avec cédula et selfie, et caution en QR ou virement non réversible.

---

## 3. Réglementation

### 3.1 Location de véhicules sans chauffeur (loueurs professionnels)
- **Aucune loi ni réglementation nationale spécifique** à la location sans chauffeur (*rent a car*) n'a été trouvée sur BACN. Ce qui s'applique selon nous : droit commun des contrats (Código Civil, *locación de cosas*), patente commerciale municipale, RUC/DNIT, inscription des véhicules au DRA, *habilitación municipal* annuelle du véhicule (Ley 5857/2017 sur l'immatriculation) et inspection technique (Ley 3850/09 modifiée par Ley 4856). INFÉRÉ / **À VALIDER**. https://www.bacn.gov.py/leyes-paraguayas/9759/ley-n-5857-establece-normas-para-la-matriculaci-n-de-los-veh-culos-automotores (CONFIRMÉ existence) ; https://www.bacn.gov.py/leyes-paraguayas/960/ley-n-4856--modifica-y-ampla-la-ley-n-385009-que-crea-el-sistema-nacional-de-inspeccin-tcnica-vehicular-y-establece-la-obligatoriedad-de-la-realizacin-de-la-inspeccin-tcnica-como-requisito-previo-para-la-obtencin-o-renovacin-de-la-patente-municipal-de-rodados-en-todo-el-territorio-nacional (CONFIRMÉ existence)
- Possible enregistrement comme prestataire touristique auprès de SENATUR (Ley 2828/05 du tourisme). **À VALIDER**.

### 3.2 Location de véhicules privés par des particuliers et plateformes d'intermédiation
- Aucune norme interdisant ou encadrant spécifiquement le P2P n'a été trouvée : **zone grise**. INFÉRÉ / **À VALIDER** (point critique).
- Questions ouvertes : un particulier qui loue de façon répétée devient-il commerçant (patente, IVA, IRE simple) ? Le véhicule « particular » doit-il changer de catégorie ? La police d'assurance du propriétaire couvre-t-elle l'usage locatif (exclusion probable) ?
- Plateformes de transport : selon le CIAT, les plateformes d'intermédiation de transport terrestre au Paraguay **déclarent et paient l'IVA directement**, ce qui crée un précédent fiscal pour les plateformes. DOCUMENTÉ-SECONDAIRE. https://ciatdata.ciat.org/public/files/library/pdfs/documentos-trabajo/2025/DT_05_2025.epub

### 3.3 Assurance obligatoire et assureurs partenaires
- **Ley 4950/2013 (SOAT)** : promulguée le **14/06/2013** et publiée le **17/06/2013** (BACN ; corrigé VERIF_02-PY-04), **suspendue en janvier 2014** après des protestations et des menaces d'action en inconstitutionnalité des municipalités, puis **abrogée par la loi 5150**. **Il n'existe aujourd'hui aucune assurance auto obligatoire en vigueur.** CONFIRMÉ (BACN) + DOCUMENTÉ-SECONDAIRE (ABC). https://www.bacn.gov.py/leyes-paraguayas/3092/ley-n-4950-crea-el-seguro-obligatorio-de-accidentes-de-transito-soat ; https://www.abc.com.py/edicion-impresa/suplementos/judicial/marchas-y-contramarchas-del-soat-1213284.html
- Le sigle « SOAPA » du brief **ne correspond pas** aux textes : il s'agit du **SOAT** (loi 4950) et d'un nouveau projet **SOA**.
- **Projet SOA** : adopté par une chambre (*media sanción*) ; l'Asociación Paraguaya de Compañías de Seguros (APCS) cherche à le relancer (juillet 2026). Il ne prévoit pas d'amendes mais permettrait la retenue du véhicule non assuré. DOCUMENTÉ-SECONDAIRE. https://www.ultimahora.com/buscan-reimpulsar-el-seguro-obligatorio-los-automoviles-n3061684
- **Seulement ≈ 25–30 % du parc est assuré**. DOCUMENTÉ-SECONDAIRE. https://infonegocios.com.py/infofinanzas/alerta-en-seguros-cobertura-automotor-no-llega-al-30-y-piden-obligatoriedad
- Conséquence (INFÉRÉ) : les tiers victimes sont souvent non indemnisés. La plateforme **doit fournir sa propre couverture RC et dommages** et ne peut pas compter sur une assurance obligatoire.
- **Marché de l'assurance** (Superintendencia de Seguros du BCP) : l'auto représente ≈ **40 % des primes** ; les primes directes ont progressé de +9,3 % sur l'exercice 2025/26. Classement général : **Mapfre n°1 (11,1 %)**, Aseguradora del Este (10,7 %), Aseguradora Yacyretá (3e) ; **Patria** est n°2 en bénéfices 2024/25 (USD 14,2 M) ; Mapfre détiendrait ≈ 17 % de l'auto (source secondaire faible). DOCUMENTÉ-SECONDAIRE. https://www.lanacion.com.py/columnistas/2026/06/21/mercado-de-primas-de-seguros-en-paraguay-10-meses-de-gestion-periodo-20252026/ ; https://www.lanacion.com.py/negocios_edicion_impresa/2025/08/17/companias-de-seguros-mercado-de-primas-a-ejercicio-20242025/
- **Partenaires à approcher (INFÉRÉ)** : Mapfre Paraguay (leader auto, expertise multinationale du P2P), Aseguradora del Este, Yacyretá, Patria, La Consolidada, Sancor Seguros Paraguay, Rumbos, El Comercio, Fénix, Tajy. La présence et la taille de Sancor et La Consolidada n'ont pas été confirmées : **À VALIDER**. Référence régionale : TripWip travaille avec **un assureur par pays** : **Sancor** en Uruguay, **RUS (Río Uruguay Seguros)** en Argentine, **AXA** au Mexique (corrigé VERIF_05-V5-11). DOCUMENTÉ-SECONDAIRE — https://www.forbesargentina.com/negocios/tripwip-startup-uruguaya-alquiler-autos-cerro-ronda-inversion-us-42-millones-escalar-mexico-argentina-n93770 ; https://raising.fi/news/tripwip-seed-july-2026

### 3.4 Contrats et signature électronique
- **La Ley 4017/2010 est ABROGÉE** et remplacée par la **Ley 6822/2021** sur les services de confiance, documents électroniques et documents transmissibles électroniques, en vigueur depuis mai 2022 et réglementée par le Décret 7576/2022. CONFIRMÉ (BACN, Poder Judicial). https://www.bacn.gov.py/leyes-paraguayas/10318/ley-n-6822-de-los-servicios-de-confianza-para-las-transacciones-electr-nicas-del-documento-electr-nico-y-los-documentos-transmisibles-electr-nicos ; https://www.mic.gov.py/wp-content/uploads/2025/06/Decreto_7576-2022.pdf
- La signature électronique simple est juridiquement valable. Seule la **signature électronique qualifiée** (émise par un prestataire qualifié, au nombre de 6 en 2026) **équivaut à la signature manuscrite**. DOCUMENTÉ-SECONDAIRE (MITIC, ABC 08/2026). https://www.abc.com.py/economia/2026/08/03/firma-electronica-sepa-las-diferencias-entre-la-cualificada-y-no-cualificada/
- Contrats électroniques : **Ley 4868/2013** sur le commerce électronique (autorité : MIC). DOCUMENTÉ-SECONDAIRE (existence de la loi, source de presse ; texte officiel BACN à citer) (requalifié A24-15). https://www.abc.com.py/nacionales/sensibilizan-sobre-ley-de-comercio-electronico-1230392.html
- **INFÉRÉ / À VALIDER** : le click-wrap suffit pour la relation plateforme–utilisateur. En revanche, pour l'**autorisation de conduite d'un véhicule de tiers** (contrôles routiers) et le **passage de frontière**, un document papier ou notarié pourrait être exigé (voir §4.7).

### 3.5 Identité, permis, âge
- **Ley 5016/2014**, loi nationale de transit et sécurité routière : crée l'ANTSV ; l'article 24 fixe les conditions de délivrance du permis (municipal). DOCUMENTÉ-SECONDAIRE (existence de la loi, source de presse ; texte officiel BACN à citer) (requalifié A24-15) ; contenu de l'article 24 **À VALIDER**. https://www.ultimahora.com/solo-50-comunas-nivel-pais-tienen-condiciones-expedir-licencias-n3028143
- Âge minimum pour conduire : 18 ans (INFÉRÉ, standard régional, À VALIDER). Les loueurs exigent en pratique **21 ans** ou plus (DOCUMENTÉ-SECONDAIRE, Skyscanner).
- **Permis étrangers** : règle Mercosur de reconnaissance du permis national pour la circulation temporaire ou touristique (DOCUMENTÉ-SECONDAIRE). Accords bilatéraux CONFIRMÉS (BACN) avec le **Chili (Ley 7111)**, la **Colombie (Ley 7142)** et l'**Espagne (Ley 3285)**. https://www.bacn.gov.py/leyes-paraguayas/11709/ley-n-7111-aprueba-el-convenio-entre-la-rep-blica-del-paraguay-y-la-rep-blica-de-chile-sobre-reconocimiento-rec-proco-y-canje-de-licencias-de-conducir ; https://www.bacn.gov.py/leyes-paraguayas/11933/ley-n-7142-que-aprueba-el-acuerdo-entre-la-rep-blica-del-paraguay-y-la-rep-blica-de-colombia-sobre-reconocimiento-rec-proco-de-licencias-de-conducir
- Hors Mercosur (US, UE hors Espagne) : le Paraguay **n'est pas listé parmi les parties à la Convention de Vienne de 1968** par les sources spécialisées ; il est partie à la **Convention de Genève de 1949** sur la circulation routière (adhésion le 18/10/1965 selon la Collection des traités des Nations unies, chapitre XI-B-1) ; l'automobile-club (TACPy) cite aussi la convention de Washington de 1943. **Règle produit** : exiger le **permis international** pour tout permis non Mercosur et non couvert par un accord bilatéral (corrigé VERIF_02-PY-05). DOCUMENTÉ-SECONDAIRE (résultat de recherche citant UNTC ; PDF UN non ouvert) — https://treaties.un.org/doc/Publication/MTDSG/Volume%20I/Chapter%20XI/XI-B-1.en.pdf ; https://internationaldrivingpermit.org/es/country/paraguay/ ; À VALIDER (acceptation pratique par la Policía Caminera).
- Identité : **cédula de identidad** (Policía Nacional – Identificaciones) pour les résidents ; passeport ou document Mercosur pour les étrangers. Les résidents récents peuvent avoir une cédula de *extranjero*.

### 3.6 Protection des données
- **Ley N° 7593/2025** sur la protection des données personnelles, **promulguée et publiée à la Gaceta Oficial le 27/11/2025**. Elle crée l'**Agencia Nacional de Protección de Datos Personales** (rattachée au MITIC). CONFIRMÉ (BACN). https://www.bacn.gov.py/leyes-paraguayas/12924/ley-n-75932025--de-proteccin-de-datos-personales-en-la-repblica-del-paraguay
- Entrée en application : partielle dès le 28/11/2025 selon certaines sources ; **période transitoire d'environ 24 mois (≈ nov. 2027)** selon d'autres. Sanctions jusqu'à **10 000 jornales** (salaires journaliers minimum). DOCUMENTÉ-SECONDAIRE / **À VALIDER**. https://dplnews.com/?p=324455 ; https://abogados.com.ar/promulgacion-de-la-ley-de-proteccion-de-datos-personales-en-la-republica-del-paraguay/38501
- Lois antérieures toujours pertinentes : **Ley 6534/2020** (données de crédit) et Ley 1682/01. DOCUMENTÉ-SECONDAIRE.
- **INFÉRÉ** : la géolocalisation GPS, la biométrie KYC (selfie) et les transferts vers un cloud étranger nécessiteront une base légale, un consentement explicite et des garanties de transfert. Concevoir le produit « privacy-by-design » dès le lancement.

### 3.7 Protection du consommateur
- **Ley 1334/98** sur la défense du consommateur (modifiée notamment par les lois 2340/03, 5427/15, 6366/19 et 6624). **SEDECO** (Secretaría de Defensa del Consumidor, créée par la Ley 4974/2013) en est l'autorité. Obligation d'un **Centre d'attention au consommateur (CAC)**. Les **contrats d'adhésion** sont réglementés par la résolution SDCU 01/2023 (articles 24, 25 et 28), avec un processus de certification. CONFIRMÉ (BACN) + DOCUMENTÉ-SECONDAIRE. https://www.bacn.gov.py/leyes-paraguayas/897/ley-n-1334--de-defensa-del-consumidor-y-del-usuario ; https://abogados.com.ar/contratos-de-adhesion-requisitos-esenciales-y-proceso-de-certificacion/32178 ; https://www.ferrere.com/en/news/obligacion-de-contar-con-un-centro-de-atencion-al-consumidor-cac/
- **À VALIDER** : faut-il faire certifier les CGU et contrats de location par SEDECO ? Quelle est la portée du droit de rétractation dans la vente à distance (article 26) ?

### 3.8 Fiscalité
| Impôt | Constat | Tag |
|---|---|---|
| **IVA** | Taux général de **10 %** (Ley 6380/2019, Décret 3107/2019). La location de biens meubles est a priori soumise à 10 % (**À VALIDER** : éventuel taux réduit de 5 %) | DOCUMENTÉ-SECONDAIRE / À VALIDER |
| **IRE** (impôt sur les sociétés) | 10 % (Ley 6380/2019) ; régimes IRE Simple et RESIMPLE pour les petits contribuables | INFÉRÉ (connaissance générale) / À VALIDER |
| **IRP-RGC** (revenus du capital des personnes physiques) | Le taux de **8 %** vient de la **Ley 6380/2019** (art. 47 et suivants), pas de la RG 69/20. La mention « 2,4–4 % sur certaines assiettes » est **retirée** (non sourcée). La RG 69/20 prévoit une inscription dans les **30 jours ouvrables** à compter d'événements précis, et **dès le début de l'activité** pour la location immobilière. La qualification de la location d'un **bien meuble** (voiture) par un hôte P2P en IRP-RGC **n'est pas démontrée** (corrigé VERIF_02-PY-10) | CONFIRMÉ (DNIT RG 69/20, Ley 6380) https://www.dnit.gov.py/web/portal-institucional/w/resolucion-general-n-69-20 / **À VALIDER** : qualification « capital » (IRP-RGC) ou « activité commerciale » (IRE) pour un hôte P2P |
| Non-résidents / services numériques | RG 114/22 : enregistrement des prestataires numériques non résidents ; RG 76/2020 : retenue INR et perception de l'IVA. Taux INR effectif cité ≈ 4,5 % (15 % × base présumée 30 %) | CONFIRMÉ (DNIT) https://www.dnit.gov.py/web/portal-institucional/w/resolucion-general-n-114-22 / À VALIDER |
| **Facturation électronique SIFEN** | Depuis le **1/01/2025** (**RG DNIT 01/24** du 12/01/2024, modifiant la RG 105/2021), toute personne morale **nouvellement inscrite au RUC** émet exclusivement en électronique. Calendrier des autres contribuables : **RG 21/2024** (et non 21/2025), puis **RG 52/2026** qui ajoute six groupes (≈ 3 000 contribuables) avec des échéances du 1/06/2026 au **1/09/2027**. Plus de 50 000 émetteurs. **Conséquence pratique** : une SA, SRL ou EAS créée pour le lancement doit être sur SIFEN dès le premier jour (corrigé VERIF_02-PY-02) | CONFIRMÉ (DNIT, RG 01/24 lue) https://www.dnit.gov.py/web/portal-institucional/w/resolucion-general-dnit-n-01/24 ; https://www.dnit.gov.py/web/portal-institucional/w/dnit-designa-nuevos-facturadores-electr%C3%B3nicos + DOCUMENTÉ-SECONDAIRE https://impuestospy.com/impuestos/resolucion-general-dnit-n-52-2026/ |

**Architecture fiscale à valider (INFÉRÉ)** :
- (a) modèle « agent » : la plateforme facture sa commission avec IVA via SIFEN, et l'hôte (s'il a un RUC) facture la location ;
- (b) modèle « principal » : la plateforme facture toute la location, puis reverse et retient.

Les hôtes particuliers sans RUC représentent un **frein majeur**. Une solution d'onboarding RUC et un partenariat comptable pourraient servir de différenciateur.

---

## 4. Risques opérationnels

### 4.1 Vol et trafic transfrontalier
- *Supprimé* : les chiffres « 357 vols de véhicules, 5 003 vols de motos, 829 voitures récupérées en 2025 » provenaient de Diario Libre et concernaient la **République dominicaine** (Dicrim), pas le Paraguay (corrigé VERIF_02-PY-01).
- **Données paraguayennes retenues** (Policía Nacional, Departamento de Control de Automotores, déclarations à la presse ; **aucune statistique annuelle officielle publiée n'a été trouvée**) :
  - **Déc. 2025** : « entre 1 et 3 autos » volés par jour au niveau national, contre « 6 o 7 robos diarios » vers la mi-2025 ; la police affirme récupérer davantage de véhicules qu'il n'en est volé (« más recuperados que robados día a día ») ; modèles les plus volés : Toyota Vitz, Allion, Premio, Auris, Runx/Allex (filière « vía Chile »). DOCUMENTÉ-SECONDAIRE — ABC Color, 16/12/2025 : https://www.abc.com.py/policiales/2025/12/16/estos-son-los-vehiculos-mas-robados-diariamente-segun-la-policia/ ; RDN, 17/12/2025 : https://www.rdn.com.py/2025/12/17/policia-revela-los-modelos-de-autos-mas-robados-en-el-pais/
  - **Août 2025** : 3 à 5 vols de véhicules par jour selon la Police nationale (Radio Monumental). DOCUMENTÉ-SECONDAIRE — https://www.monumental.com.py/noticias/el-que-avisa-no-traiciona/tres-a-cinco-vehiculos-son-robados-diariamente-en-paraguay
  - **Mai 2024** : plus de 500 véhicules volés en moins de six mois (≈ 3 par jour, 79 en mai), 76 % récupérés (article daté du 30/05/2024, la date de 2026 affichée sur la page étant la date du jour). DOCUMENTÉ-SECONDAIRE — https://www.ultimahora.com/mas-de-500-vehiculos-se-robaron-en-menos-de-seis-meses-en-paraguay
  - **Fourchette de travail retenue** : **≈ 700 à 1 800 vols de voitures par an** (1 à 5 par jour selon la période), en baisse fin 2025. INFÉRÉ à partir des déclarations ci-dessus ; **lacune** : statistique annuelle officielle 2024–2025 non trouvée (Policía Nacional / Ministerio del Interior).
- Autres données : 833 voitures volées en 2018 ; 4 à 5 par jour en avril 2023 (ABC). **Exfiltration notamment via le Chili** ; véhicules volés au Brésil retrouvés à CDE. DOCUMENTÉ-SECONDAIRE. https://www.ultimahora.com/mas-de-500-vehiculos-se-robaron-en-menos-de-seis-meses-en-paraguay ; https://www.ultimahora.com/cuales-son-los-vehiculos-mas-robados-paraguay-n1149322 ; https://www.abc.com.py/policiales/2023/04/22/unos-cinco-vehiculos-son-robados-por-dia-en-paraguay/
- Selon un article, **un véhicule volé sur trois sert à commettre des agressions**. DOCUMENTÉ-SECONDAIRE. https://www.hoy.com.py/nacionales/de-cada-3-vehiculos-robados-roban-hasta-5-por-dia-uno-es-para-asaltos-las-marcas-preferidas
- Le Paraguay est aussi une **destination** de véhicules volés au Brésil et en Bolivie (trafic historique). INFÉRÉ / DOCUMENTÉ-SECONDAIRE (titres de presse CDE).
- **INFÉRÉ** : les modèles les plus ciblés (Toyota, « chileré ») et les pick-ups devraient avoir un **GPS obligatoire** sur la plateforme.

### 4.2 Accidents et sinistralité
- **3–4 morts par jour** sur les routes (ANTSV, 2025). Les motocyclistes représentent ≈ 55–80 % des tués selon les sources ; au T2 2025, 2 073 motards ont été blessés, dont 55 % sans casque. DOCUMENTÉ-SECONDAIRE (citations ANTSV). https://www.abc.com.py/nacionales/2025/04/16/accidente-de-transito-cuantos-paraguayos-mueren-al-dia-en-las-rutas/ ; https://www.hoy.com.py/nacionales/2025/04/15/entre-3-a-4-paraguayos-mueren-por-dia-en-accidentes-de-transito-afirman ; https://www.ultimahora.com/la-epidemia-silenciosa-del-asfalto-motociclistas-lideran-las-muertes-viales-en-paraguay
- **INFÉRÉ** : risque élevé de collisions avec des motos non assurées, d'où le besoin d'une RC tiers solide et de dashcams recommandées.

### 4.3 Routes
- Réseau pavé en amélioration ; **PY09 (Transchaco)** dorsale du Chaco avec un nouveau péage au km 477 (Mcal. Estigarribia) ; **corridor bioocéanique** : pont vers Porto Murtinho (Brésil) à ≈ 80 % (2026). DOCUMENTÉ-SECONDAIRE. https://www.ultimahora.com/nuevo-puesto-de-peaje-en-el-chaco ; https://www.ultimahora.com/avances-en-puente-de-la-ruta-bioceanica-cerca-del-80
- Beaucoup de routes secondaires du Chaco sont en **terre et impraticables après la pluie**. INFÉRÉ (connaissance générale) / À VALIDER. Il faudra des règles d'usage par zone (interdiction du hors-piste sauf pour les véhicules 4x4 labellisés).

### 4.4 Péages
- Péages MOPC et concessions : **Ecovía PYG 15 000** pour les véhicules légers (depuis le 02/01/2025) ; Coronel Bogado PYG 10 000 ; Ypacaraí PYG 10 000 ; Tape Porã (PY02) PYG 19 000 (juillet 2025) ; pas de hausse prévue en 2026 sur Rutas del Este. Paiement **en espèces ou par carte, pas de QR** à l'Ecovía. Pas de télépéage généralisé identifié. DOCUMENTÉ-SECONDAIRE. https://www.lanacion.com.py/negocios/2025/01/02/afirman-que-ajuste-en-peajes-administrados-por-el-mopc-no-se-realizaba-hace-11-anos/ ; https://www.abc.com.py/economia/2025/07/01/tape-pora-desde-cuando-rige-la-nueva-tarifa-del-peaje-y-cuanto-costara/ ; https://www.hoy.com.py/nacionales/2026/01/02/peaje-en-ecovia-confirman-pago-en-efectivo-y-con-tarjetas-pero-descartan-qr
- **INFÉRÉ** : les péages sont payés par le conducteur sur place ; peu d'enjeu de refacturation.

### 4.5 Amendes
- Contrôles par la **Policía Caminera** (routes nationales) et les **polices municipales de transit** (PMT) ; la responsabilité du titulaire pour les amendes au conducteur relève de règles municipales hétérogènes. **À VALIDER**. Il faudra un processus de transfert de responsabilité (contrat, et déclaration du conducteur si elle est possible).

### 4.6 Assistance routière et GPS
- Fournisseurs GPS locaux : **Autoclick Satelital** (> 5 500 clients, récupération annoncée en moins d'une heure « dans de nombreux cas ») ; nombreux autres via les marchés publics. DOCUMENTÉ-SECONDAIRE. https://infonegocios.com.py/infomotor/tu-auto-bajo-control-el-rastreo-satelital-ya-no-es-un-lujo-sino-una-necesidad-que-protege-en-tiempo-real
- Assistance routière : généralement incluse dans les polices auto (Mapfre, etc.) ; couverture faible dans le Chaco. INFÉRÉ / À VALIDER.

### 4.7 Passage des frontières
- Le Mercosur permet la circulation touristique avec le permis national, une pièce d'identité et la **preuve de propriété ou une autorisation**. Pour un véhicule de location, **l'autorisation est délivrée par le loueur**. Pour un véhicule dont le conducteur n'est pas titulaire, il faut une autorisation devant **notaire (escribano)** ou juge de paix. DOCUMENTÉ-SECONDAIRE (Colegio de Escribanos AR, guides). https://www.derechoenzapatillas.com/2023/requisitos-para-circular-vehiculos-en-el-mercosur-argentina-brasil-uruguay-paraguay/ ; https://www.colegio-escribanos.org.ar/noticias/2014_12_19-Cuadro_Autorizaciones_menores_salida_vehiculos.pdf
- En Argentine, le loueur doit être inscrit au registre *Rent a Car* de la douane argentine. Peu de loueurs de Foz autorisent l'entrée au Paraguay. DOCUMENTÉ-SECONDAIRE. https://autotest.com.ar/consejos/viajar-a-paraguay-en-auto-2024/ ; https://www.hoteltarobafoz.com.br/en/transito-no-paraguai-fronteira/
- **Recommandation (INFÉRÉ)** : **interdire par défaut la sortie du territoire** au lancement (géofencing GPS avec alerte à moins de X km de la frontière). Proposer plus tard une option « Mercosur » payante avec autorisation notariée et assurance « carta verde » ou extension Mercosur RC. **À VALIDER** (assureur, avocat).

### 4.8 Langues du service client
- **Espagnol** (indispensable), **guaraní** (langue officielle, parlée par la majorité, utile pour la relation téléphonique et WhatsApp), **portugais** (Brésiliens : immigrés, CDE, *brasiguayos*), anglais (expatriés). INFÉRÉ (données générales).

---

## 5. Opportunités et adaptations spécifiques

1. **Lancement à Asunción + ASU d'abord** (affaires, MICE, diaspora, expatriés), puis Encarnación (saison d'été), le Chaco (B2B agro) et CDE en dernier (risque de vol et de frontière). INFÉRÉ.
2. **Modèle hybride « pro-first »** : intégrer d'abord les **petits loueurs locaux et concessionnaires** (RUC, facturation SIFEN, flotte assurée), puis ouvrir le P2P à des hôtes vérifiés. Ce modèle contourne en partie la zone grise et l'absence de RUC des particuliers. INFÉRÉ.
3. **Catégorie « VTC » — hors MVP, flottes professionnelles uniquement** (location hebdomadaire ou mensuelle à ≈ 30 000 chauffeurs) : pas d'hôtes particuliers sur ce segment (échecs HyreCar et Moobie) ; en phase ultérieure, offre réservée à des flottes pros avec assurance flotte, caution et GPS avec coupure moteur à distance (*corte de motor*). Aucun équivalent de Kovi n'a été identifié. INFÉRÉ (corrigé VERIF_02-C-06).
4. **Catégorie « Agro/Chaco 4x4 »** (Hilux, S10, Ranger) avec des règles hors bitume et des tarifs USD 70–120/jour. INFÉRÉ.
5. **Moyenne durée pour expatriés** (1 à 3 mois) avec une interface en portugais et en anglais. INFÉRÉ.
6. **Paiements** : carte via Bancard vPOS ou dLocal, plus **QR Bancard** et **portefeuilles électroniques** (Tigo Money) pour les clients sans carte de crédit. Caution par pré-autorisation ou versement QR restituable. Affichage en PYG sans décimales, avec un équivalent USD. INFÉRÉ.
7. **Assurance embarquée** (B2B2C) avec Mapfre ou un autre assureur : RC tiers, dommages, vol (franchise selon un niveau de protection) ; **GPS obligatoire** au-dessus d'un certain seuil de valeur. Le faible taux d'assurance du parc (25–30 %) **réduit le nombre d'hôtes « prêts »**, d'où l'intérêt de faire de l'assurance un produit d'appel pour les propriétaires. INFÉRÉ.
8. **Conformité Ley 7593** dès la conception (consentement GPS, politique de conservation, registre des traitements). INFÉRÉ.
9. **Service client WhatsApp-first** en espagnol, guaraní et portugais. INFÉRÉ.

---

## 6. Principaux risques

| # | Risque | Gravité | Commentaire |
|---|---|---|---|
| R1 | **Vide juridique sur le P2P** (requalification de l'hôte en commerçant, sanctions municipales ou fiscales) | Élevée | À VALIDER avec un avocat ; le modèle pro-first atténue ce risque |
| R2 | **Pas d'assurance auto obligatoire, faible taux d'assurance, offre P2P inexistante chez les assureurs** | Élevée | Le partenariat assureur conditionne le lancement |
| R3 | **Vol, exfiltration transfrontalière, agressions** (y compris contre les chauffeurs VTC) ; 1 à 7 voitures volées par jour selon la période (Police nationale, 2025), statistique annuelle officielle non trouvée (corrigé VERIF_02-PY-01) | Élevée | GPS obligatoire, KYC renforcé, géofencing, limites de zone (CDE, PJC) |
| R4 | **Sinistralité routière** (motos non assurées) | Moyenne-élevée | Coût des sinistres à modéliser |
| R5 | **Paiements** : pas de Stripe ni de Stripe Global Payouts, cautions sur débit, payouts aux hôtes sans RUC, **statut de PSP possible auprès du BCP** (règlement PSP de déc. 2025, registre obligatoire), risque de change PYG | Moyenne | dLocal ou PSP enregistré + virements SIPAP ; intégrer les plafonds QR (1,5 %) et cartes (3 %/2 %) au modèle de coûts (corrigé VERIF_02-PY-03 / X-01) |
| R6 | **Fiscalité** : IVA, IRP, SIFEN dès le premier jour pour une nouvelle société (RG 01/24), retenues potentielles | Moyenne | Expert-comptable local |
| R7 | **Taille de marché limitée** (≈ 1,3 M de passagers à ASU, soit ≈ 0,64 M d'arrivées) | Moyenne | Le Paraguay est un marché de test ou de satellite plutôt qu'un marché de volume (corrigé VERIF_02-PY-07) |
| R9 | **Segment VTC** (modèle HyreCar/Moobie) | Élevée si ouvert au P2P | Exclu du MVP ; flottes pros seulement (corrigé VERIF_02-C-06) |
| R8 | **Entrée d'un concurrent régional** (TripWip, Localiza Assinatura, Kovi/Moove) | Faible-moyenne | Avantage du premier entrant **limité** : les barrières (assurance, conformité) se lèvent pour tout le monde dès qu'un assureur crée un produit ; viser une exclusivité ou une priorité avec l'assureur partenaire (aligné sur 14 (c) 8, corrigé VERIF_05-V5-18) |

---

## 7. Questions pour les conseils locaux

### Avocat (droit commercial, transport, consommation, données)
1. Un particulier peut-il louer son véhicule « particular » contre rémunération via une plateforme ? Existe-t-il une ordonnance municipale (Asunción, CDE, Encarnación) visant la location sans chauffeur ?
2. Faut-il une habilitation spécifique (municipale, MOPC/DINATRAN, SENATUR) pour un *rent a car* ou pour une plateforme d'intermédiation ?
3. Quel document permet légalement à un locataire de conduire le véhicule d'un tiers lors d'un contrôle de la Policía Caminera ou de la PMT : contrat électronique, autorisation notariée, « cédula verde » ?
4. La signature électronique simple (Ley 6822/2021) suffit-elle pour le contrat de location et la reconnaissance de dommages ? Dans quels cas faut-il une signature qualifiée ?
5. Faut-il faire certifier les contrats d'adhésion par SEDECO (résolution SDCU 01/2023) ? Quelles sont les obligations du CAC ?
6. Ley 7593/2025 : calendrier exact d'application, base légale du GPS et de la biométrie, transferts internationaux, désignation d'un DPO.
7. Quelles sont les règles de sortie du territoire d'un véhicule loué vers l'Argentine, le Brésil et la Bolivie ? Faut-il un registre douanier (DNA) ?
8. Qui est responsable des amendes de transit (titulaire ou conducteur) et existe-t-il une procédure de désignation du conducteur ?
9. La plateforme est-elle responsable (solidairement) envers les tiers en cas d'accident causé par un locataire ?

### Assureur (Mapfre, Patria, Aseguradora del Este, Yacyretá, Sancor, La Consolidada…)
1. Existe-t-il une police flotte ou plateforme couvrant l'usage locatif P2P (RC, dommages, vol, bris de glace) ? Quels plafonds RC et quelles franchises ?
2. Les polices auto des particuliers excluent-elles la location à titre onéreux ?
3. Quelles sont les exigences de GPS et de récupération ? Quel tarif selon la zone (CDE, frontière) ?
4. Peut-on obtenir une extension Mercosur (RC à l'étranger, carta verde) ?
5. Assistance routière nationale (couverture du Chaco) ; délais de règlement des sinistres.
6. Quel est le calendrier probable du projet de loi SOA ?

### Expert-comptable / fiscaliste
1. L'hôte particulier relève-t-il de l'IRP-RGC (8 %) ou de l'IRE ? Doit-il obligatoirement s'inscrire au RUC et facturer l'IVA ? Existe-t-il un seuil ?
2. Quel est le taux d'IVA sur la location de véhicules (10 % ou taux réduit) ? Sur la commission de la plateforme ?
3. Vaut-il mieux une entité locale ou un non-résident (RG 114/22 sur les services numériques) ? Quelles sont les obligations d'agent de retenue sur les paiements aux hôtes ?
4. SIFEN pour une nouvelle SA/SRL/EAS (obligation immédiate depuis le **1/01/2025**, RG 01/24 — corrigé VERIF_02-PY-02) : comment facturer pour le compte de tiers ?
4 bis. La plateforme doit-elle s'enregistrer comme **PSP** auprès du BCP (règlement de déc. 2025) si elle encaisse pour compte des hôtes ? (corrigé VERIF_02-PY-03)
5. Payouts en USD ou PYG : traitement de change, retenues bancaires, IVA sur les cautions conservées.

---

## 8. Notation synthétique (1 = défavorable, 5 = très favorable)

| Dimension | Note | Justification |
|---|---|---|
| **Demande** | **2,5/5** (abaissée de 3, corrigé VERIF_02-PY-06/PY-07/C-06) | Records récents, mais ASU ≈ 0,64 M d'arrivées (1,29 M de mouvements), 2,03 M de touristes (et non 3,66 M de visiteurs, dont la hausse de +91 % est probablement méthodologique), surtout argentins venus en voiture ; immigration +60–80 % ; parc de 3,1 M en croissance de ≈ 5 %/an. La demande VTC n'est plus comptée (segment exclu du MVP). |
| **Paiements** | **2,5/5** (abaissée de 3, corrigé VERIF_02-X-01/PY-03) | Écosystème QR, cartes et portefeuilles très avancé, plafonds de commissions en baisse (cartes 3 %/2 %, QR 1,5 %), dLocal disponible. En contrepartie : pas de Stripe ni de Stripe Global Payouts, cartes de crédit probablement peu répandues, PYG, cautions et payouts à concevoir, **statut de PSP possible** au titre du règlement BCP de déc. 2025. |
| **Réglementation** | **2/5** (critère **éliminatoire**, non compensable : voir 12 §10) | Aucun cadre P2P, aucune assurance obligatoire (SOAT abrogé), fiscalité de l'hôte incertaine, SIFEN obligatoire, nouvelle loi sur les données. Points positifs : cadre de signature électronique moderne (Ley 6822) et pas d'interdiction explicite. |
| **Opérations** | **2/5** | Vol et exfiltration transfrontalière, forte sinistralité (motos), routes du Chaco, faible taux d'assurance. Atténuable avec du GPS, du KYC et du géofencing, mais à un coût élevé. |
| **Concurrence** | **4/5** (vue P2P, Phase 1) ; **3/5 en pro-first** dans la matrice 12 §10.2 (corrigé VERIF_05-V5-04) | Aucun acteur P2P identifié ; les loueurs traditionnels sont peu chers (USD 15–46/jour) mais peu nombreux et peu digitaux. Le risque d'entrée de TripWip ou de Localiza reste modéré. Pour un MVP de loueurs, les concurrents directs sont les agrégateurs (Kayak : 16–18 enseignes à Asunción ; Rentcars à ASU) et les sites des loueurs ; « peu de loueurs » est alors une **contrainte d'offre** (critère « profondeur de l'offre pro », 2,5/5). |
| **Global** | *Moyenne simple supprimée* (corrigé VERIF_02, remarque sur les notes globales) | Une moyenne masque le caractère éliminatoire de la réglementation et de l'assurance. La décision est prise au §10 (renvoi à `12_PANAMA_MARKET.md` §10). Lecture : marché « pilote » possible pour un modèle **pro-first + P2P vérifié**, à condition de sécuriser au préalable un partenariat assureur, un avis juridique et fiscal et le statut PSP. |

---

## 9. Sujets décisionnels complémentaires (Phase 5, réponse à VERIF_02 §3)

*Recherche web du 30/10/2026. « Non trouvé » signifie qu'aucune source publique n'a été identifiée ; rien n'est extrapolé au-delà des sources.*

### 9.1 Création de société et propriété étrangère

| Point | Constat | Tag | Source |
|---|---|---|---|
| Formes | **SA** ou **EAS** (Empresa por Acciones Simplificadas, **Ley 6480/2020**, Décret 3998/2020) ; la SRL est moins utilisée par les investisseurs étrangers. L'EAS se constitue **en ligne via le SUACE** (Ley 6867/2021), **coût de constitution nul**, sans capital minimum | CONFIRMÉ (BACN, existence de la loi) / DOCUMENTÉ-SECONDAIRE (procédure) | https://www.bacn.gov.py/leyes-paraguayas/9100/ley-n-6480-crea-la-empresa-por-acciones-simplificadas-eas ; https://mic.gov.py/wp-content/uploads/2024/12/FICHA-INCENTIVOS_EAS_ESPNAOL.pdf ; https://www.bizlatinhub.com/es/tipo-entidades-legales-paraguay/ |
| Investisseurs étrangers | **Ley 117/91** : égalité de traitement avec les nationaux ; aucune réserve sectorielle comparable à celle du Panama sur le commerce de détail n'a été trouvée | CONFIRMÉ (BACN) / DOCUMENTÉ-SECONDAIRE | https://www.bacn.gov.py/leyes-paraguayas/785/ley-n-117-de-inversiones ; https://investmentpolicy.unctad.org/investment-laws/laws/138/paraguay-ley-de-inversiones |
| Délai de constitution pour un étranger, représentant légal résident | **Non trouvé** | non trouvé | — |
| Obligation SIFEN | Toute nouvelle personne morale émet uniquement en électronique depuis le 1/01/2025 (§3.8) | CONFIRMÉ | RG DNIT 01/24 |

### 9.2 Change, rapatriement des fonds et fiscalité des dividendes

| Point | Constat | Tag | Source |
|---|---|---|---|
| Liberté des changes | Ley 117/91 : « régimen de libertad de cambio sin restricciones » pour l'entrée et la sortie de capitaux et la remise de dividendes, intérêts, commissions et redevances (article 3 selon l'UNCTAD, article 6 selon l'ICEX) | CONFIRMÉ (texte cité par l'UNCTAD) | https://investmentpolicy.unctad.org/investment-laws/laws/138/paraguay-ley-de-inversiones |
| Nuance Ley 5542/2015 | Pour les investissements placés sous ce régime de garanties : remises de bénéfices sans délai, **remises de capital après deux ans** ; accès au marché des changes soumis aux règles anti-blanchiment | DOCUMENTÉ-SECONDAIRE (résumé de la loi) / À VALIDER | https://www.bacn.gov.py/leyes-paraguayas/4523/ley-n-5542-garant-as-para-las-inversiones-y-fomento-a-la-generaci-n-de-empleo-y-el-desarrollo-econ-mico-y-social-br |
| Dividendes (IDU) | **8 %** pour un associé résident, **15 %** pour un non-résident, retenus par la société (Ley 6380/2019) | DOCUMENTÉ-SECONDAIRE (cabinets) | https://periscopiofiscalylegal.pwc.es/paraguay-reforma-tributaria-para-el-ano-2020/amp/ ; https://www.dnit.gov.py/web/portal-institucional/w/retiro-de-dividendos-1 |
| Services payés à la maison-mère | INR (taux effectif cité ≈ 4,5 % selon la nature du service, §3.8) | DOCUMENTÉ-SECONDAIRE / À VALIDER | §3.8 |
| Risque de change | PYG flottant : versements aux hôtes en PYG et revenus en PYG convertis en USD → coût de change et volatilité ; taux non vérifié (≈ 7 300–8 000 PYG/USD, INFÉRÉ) | INFÉRÉ | — |

### 9.3 Rails de versement aux hôtes particuliers

| Rail | Particuliers | Devise | Tag | Source |
|---|---|---|---|---|
| Stripe Global Payouts | **À VALIDER** : changelog Stripe du 27/05/2026 ajoute le Paraguay, mais la liste des pays consultée le 30/10/2026 ne le montre pas ; nécessite de toute façon licences MTL + Stripe Treasury côté plateforme (corrigé VERIF_08-V8-04, lead) | — | À VALIDER | https://docs.stripe.com/global-payouts/recipient-requirements |
| dLocal Payouts | Oui (virement bancaire) | PYG ou USD | CONFIRMÉ (doc éditeur) | https://docs.dlocal.com/docs/paraguay-payouts-v3 |
| Compte local de l'entité + SIPAP | Oui | PYG (USD possible) | DOCUMENTÉ-SECONDAIRE | §2 |
| Tigo Money / Billetera Personal (versement par API) | **Non trouvé** : aucune API publique de versement en masse ; Tigo Money est listé comme moyen d'**encaissement** par des agrégateurs (Onerway) | — | non trouvé | https://docs.onerway.com/payments/payment-methods/add-payment-methods/enable-local-payment-methods/latin-america/paraguay |
| KYC des hôtes sans RUC | Versement possible sur compte bancaire au nom de l'hôte ; l'obligation pour l'hôte d'avoir un RUC dépend de sa qualification fiscale (§3.8) | À VALIDER | — |
| Statut de la plateforme | Possible enregistrement comme **PSP** auprès du BCP si elle encaisse pour compte de tiers (Résolution BCP n° 25, Acta 58, 18/12/2025, §2) (corrigé VERIF_05-V5-10) | À VALIDER | §2 |
| Coût et délai par versement | **Non trouvé** | non trouvé | — |

### 9.4 Disponibilité d'un produit d'assurance P2P / location chez un assureur local

- **Aucun produit d'assurance P2P ou « par réservation » n'a été trouvé** chez un assureur paraguayen. **Non trouvé.**
- **Aucune assurance auto obligatoire** (§3.3) : contrairement au Panama, il n'existe pas de socle RC à compléter ; la plateforme doit tout apporter.
- Les loueurs (National, Localiza…) vendent leur propre TPL et CDW au comptoir et préviennent que les polices étrangères et celles des cartes de crédit ne couvrent généralement pas au Paraguay. DOCUMENTÉ-SECONDAIRE — https://nationalcar.com/es/alquiler-vehiculos/oficinas/py/aeropuerto-internacional-silvio-pettirossi-de-asuncion-kc03.html ; contrat Localiza Paraguay : https://www.localiza.com/Contratos/paraguay/es/Contrato_General_Alquiler_un_Auto.pdf (non lu en détail).
- Procédure et délai d'approbation d'un produit par la **Superintendencia de Seguros (BCP)** : **non trouvé**. Réassurance / *fronting* : **non trouvé**. Coût par jour : **non trouvé**.
- Pistes : MAPFRE Paraguay (n° 1 du marché, expérience P2P au Brésil avec Pegcar) ; **Sancor** (assureur de TripWip en Uruguay ; Sancor Seguros est présent au Paraguay selon la liste de §3.3, À VALIDER) ; **Río Uruguay Seguros** (assureur de TripWip en Argentine seulement ; AXA au Mexique) (corrigé VERIF_05-V5-11) ; présence de RUS au Paraguay **non trouvée** (INFÉRÉ / À VALIDER).

### 9.5 Véhicules financés ou nantis (*prenda*)

- La propriété est inscrite au **Registro de Automotores** (Dirección General de los Registros Públicos), qui délivre la cédula verde (Ley 608/95 et modifications). CONFIRMÉ (BACN, existence) — https://www.bacn.gov.py/leyes-paraguayas/2357/ley-n-608-crea-el-sistema-de-matriculacion-y-la-cedula-del-automotor
- Règles d'inscription de la *prenda* au DRA et interdiction légale de louer un véhicule nanti : **non trouvé**. Les contrats de gage examinés (modèle non identifié comme paraguayen) interdisent au débiteur de céder ou de **changer l'usage** du véhicule sans accord écrit du créancier. DOCUMENTÉ-SECONDAIRE (faible).
- Filtre d'éligibilité recommandé : certificat du DRA sans *prenda* ni inhibition, ou consentement écrit du créancier (INFÉRÉ / À VALIDER).

### 9.6 Import de véhicules, plaques et contrôle technique

- **Âge maximum des véhicules d'occasion importés** : la Ley 2018/02 autorisait l'import jusqu'à 10 ans ; la **Ley 4333/2011** a modifié l'article 1 ; la presse indique que la Cour suprême aurait déclaré cette limite inconstitutionnelle (fragment non vérifié) ; un projet à 7 ans a été déposé (date ancienne). **Règle en vigueur en 2026 : non confirmée**. DOCUMENTÉ-SECONDAIRE / À VALIDER — https://www.bacn.gov.py/leyes-paraguayas/3705/ley-n-4333-modifica-el-art-culo-1-de-la-ley-n-2-018-02-que-autoriza-la-libre-importaci-n-de-veh-culos-maquinarias-agr-colas-y-maquinarias-de-construcci-n-usados-modificada-por-la-ley-n-2-153-03-br ; https://www.abc.com.py/edicion-impresa/economia/importacion-de-usados-de-mas-de-diez-anos-frena-industria-sostienen-1609598.html
- Les « chileré » (conduite à droite convertie, souvent japonais) sont les plus volés (Toyota Allion, Premio, Vitz…) (§4.1).
- Inspection technique (Ley 3850/09 modifiée par la Ley 4856) et *habilitación* municipale : existence confirmée (§3.1) ; catégorie de plaque spécifique « location » : **non trouvée**.
- **Recommandation (INFÉRÉ)** : au lancement, n'accepter que des véhicules de moins de 8–10 ans, à conduite à gauche d'origine ou avec certificat de conversion, inspection à jour, sans *prenda*.

### 9.7 Concessions aéroportuaires (ASU)

- La DINAC a annoncé une restructuration commerciale de l'aéroport Silvio Pettirossi, avec relance des appels d'offres pour les locaux ; l'appel d'offres du parking fait l'objet d'un contrôle de la Contraloría. DOCUMENTÉ-SECONDAIRE (dates des articles peu fiables) — https://www.ultimahora.com/la-dinac-licitara-los-locales-comerciales-del-pettirossi-n2792740.html ; https://www.ultimahora.com/aeropuerto-contraloria-investigara-la-licitacion-del-estacionamiento-n1149084
- Règles de concession des **loueurs** et droit pour un hôte P2P de **livrer en zone d'arrivée** : **non trouvé**. Localiza opère un point à l'aéroport (§1.6). La livraison P2P à ASU est à considérer comme **non autorisée tant que la DINAC ne l'a pas validée** (À VALIDER).

### 9.8 Obligations anti-blanchiment (SEPRELAD)

- **Ley 1015/1997**, article 13 (sujets obligés), modifiée notamment par la **Ley 6797/2021** (prestataires d'actifs virtuels) ; une réforme de 2022 a ajouté quatre secteurs (liste non retrouvée). DOCUMENTÉ-SECONDAIRE — https://ey.com/content/dam/ey-unified-site/ey-com/es-py/technical/tax/documents/ey-legal-alert-july-2022.pdf
- Une **marketplace de location** ou un **PSP** au sens de la Ley 7503 figure-t-il parmi les sujets obligés ? **Non trouvé** ; un PSP enregistré auprès du BCP le serait vraisemblablement (INFÉRÉ / À VALIDER). Recommandation : KYC complet (cédula ou passeport, selfie), conservation des pièces, procédure de signalement.

### 9.9 Procédure en cas d'accident

- Constat par la **Policía Caminera** (routes nationales) ou la police municipale de transit (§4.5). Procédure, délai d'immobilisation et coût moyen d'un sinistre : **non trouvé**.
- En l'absence d'assurance obligatoire et avec ≈ 70 % du parc non assuré, un sinistre avec un tiers (souvent une moto) risque de **ne pas être indemnisé par la partie adverse** : le coût retombe sur la couverture de la plateforme (INFÉRÉ).

### 9.10 Reporting fiscal des revenus des hôtes

- Obligation pour une plateforme de déclarer les revenus des hôtes à la DNIT ou d'agir comme agent de retenue : **non trouvée** pour la location. Précédent : les plateformes de transport déclarent et paient l'IVA directement (CIAT, §3.2) ; régime des non-résidents numériques (RG 114/22). À VALIDER.

### 9.11 Circulation transfrontalière

- Traité au §4.7 (autorisation notariée, registre Rent a Car argentin). Recommandation inchangée : sortie du territoire interdite au lancement.

### 9.12 Unit economics par véhicule (hypothèses, Gran Asunción)

*Hypothèses de travail (INFÉRÉ) sauf mention ; à remplacer par des données de terrain, de l'assureur et du PSP.*

| Poste (par véhicule et par mois) | Hypothèse | Base |
|---|---|---|
| Prix moyen payé par jour (hors protection) | 35 $ | §1.6 (moyenne agrégateurs 32–46 $) |
| Jours loués | 8 j (≈ 27 % d'utilisation) | INFÉRÉ (demande aérienne plus faible qu'au Panama) |
| GMV location | **280 $** | calcul |
| Commission côté hôte | 22 % → 62 $ | TripWip 20–25 % (DOCUMENTÉ-SECONDAIRE) |
| Frais côté locataire | 10 % → 28 $ | INFÉRÉ |
| **Revenu plateforme** | **90 $** | calcul |
| Frais d'encaissement | ≈ 3 % (plafond crédit 3 %, QR 1,5 %) → ≈ 9 $ | BCP (CONFIRMÉ) |
| Versement et change PYG/USD | 2–4 $ | non trouvé (hypothèse) |
| Provision franchises impayées, vol, fraude | 5 % du GMV → 14 $ | INFÉRÉ (vol et tiers non assurés plus fréquents) |
| Support et litiges (≈ 2–3 réservations) | 15 $ | INFÉRÉ |
| **Marge contributive hors assurance** | **≈ 49 $ (≈ 17 % du GMV)** | calcul |
| Assurance par jour loué | **non trouvée** ; sensibilité 8–15 $/j | hypothèse |
| Si l'assurance est absorbée (10 $/j × 8 j) | **≈ −31 $** | calcul |

**Lecture** : en valeur absolue, la marge par véhicule est environ deux fois plus faible qu'au Panama ; le modèle n'est viable que si l'assurance est facturée au locataire ou portée par des loueurs professionnels.

**Limites (corrigé VERIF_05-V5-05)** : modèle P2P de Phase 1 (commission de 22 % calquée sur TripWip), utilisation déduite de la demande (double comptage si on compare les pays), frais PSP non alignés sur l'architecture retenue. **Il n'est plus pondéré dans la matrice (12 §10.2, poids 0 %).** Esquisse Phase 0 pro-first (commission loueur 12 %, l'agence encaisse) : ≈ 30 $ par véhicule-mois, contre ≈ 42 $ au Panama (INFÉRÉ, 12 §9.12).

### 9.13 Risque politique et syndical

- Mobilisations de chauffeurs Bolt en avril 2026 (§1.5) ; aucune mobilisation de taxis ou de loueurs contre la location P2P sans chauffeur n'a été trouvée (non trouvé). Risque jugé **faible à moyen** (INFÉRÉ).

---

## 10. Comparaison et recommandation de pays de lancement

**Voir `12_PANAMA_MARKET.md`, §10 « Comparaison et recommandation de pays de lancement »** (matrice commune Panama / Paraguay : critères éliminatoires, critères pondérés, recommandation et conditions à valider).

Résumé pour le Paraguay (30/10/2026, **révisé après VERIF_05**, corrigé VERIF_05-V5-07) : aucun critère éliminatoire n'est « NON ». Avec la même règle de preuve dans les deux pays, **aucun des deux ne passe tous les critères éliminatoires du pro-first sans avis juridique**, mais le Paraguay en passe davantage : l'établissement (E4 : EAS via SUACE, Ley 117/91, aucune réserve sectorielle) est **OUI**, alors qu'au Panama il est **NON VALIDÉ** (art. 288, commerce de détail, branche « representación o agencia »). E3 dépend du **statut PSP** (Résolution BCP n° 25 du 18/12/2025) ; E2a (polices flotte) est PROBABLE dans les deux pays ; le P2P et l'assurance P2P restent non validés. Le Paraguay est pénalisé par une demande aérienne plus faible et une **offre pro moins profonde** (Localiza ≈ 1 000 véhicules ; 16–18 enseignes sur Kayak).

Matrice reconstruite (6 critères, unit economics à 0 %) : **Paraguay 2,68/5** contre **Panama 2,88/5** (écart +0,20, contre +0,53 auparavant). **Le classement n'est pas stable** : le Paraguay passe devant si le critère « établissement juridique » pèse plus de 25–30 %, et il devient de fait premier si l'avis panaméen est négatif.

**Recommandation : GO CONDITIONNEL.** Panama d'abord **seulement si** un avis juridique court lève l'art. 288 et la qualification casa de remesas ; **avis parallèle au Paraguay sur le statut PSP**. **Règle de bascule** : si l'avis panaméen est négatif sans montage viable, **le Paraguay devient le premier marché** (pro-first, flux de paiement compatible avec l'avis PSP) ; sinon, le Paraguay reste le deuxième marché, 12–18 mois après le Panama (Localiza étant le premier concurrent et partenaire potentiel à surveiller). Détail : 12 §10.3.
