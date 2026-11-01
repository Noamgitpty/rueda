# US-028 — Naming et identité : propositions pour le choix du fondateur

- **Story** : US-028 (epic E16, DSN-001), lot 0
- **Rôle** : agent DESIGN
- **Date** : 2026-10-31
- **Statut** : PROPOSÉ. Rien n'est choisi tant que le fondateur n'a pas tranché (DEC-MARQUE).
- **Références** : 19 §1.6 et US-028 ; 10b §2, §3.0 (principe 8 « identité propre »), §3.3, §3.10, §4 (S01, S03, A02), §8 ; 12 §1.5 et §10 ; 13 (concurrence).
- **Fichiers** : ce document ; `presentation.html` (page visuelle avec les maquettes) ; `tokens-tierra-firme.json`, `tokens-senal.json` et `tokens-istmo.json` (jetons prêts pour US-030).

> **En 30 secondes.** Nous recommandons le nom **Yave** (la clé remise au comptoir), suivi de **Tramo** puis de **Volante**. Trois directions visuelles sont proposées : **Tierra firme** (chaleureuse), **Señal** (précise, pensée pour le comptoir) et **Istmo** (tropicale et très lisible). Toutes les combinaisons sont possibles. Pour voir les écrans, ouvrez `presentation.html`. La grille de choix se trouve à la fin de ce document.

---

## 1. Brief retenu

| Contrainte | Ce qu'elle implique pour le nom et l'identité |
|---|---|
| Marchés PA puis PY, et pro-first : les loueurs professionnels d'abord | Le nom doit sonner sérieux pour une agence et rassurant pour un touriste. Il ne doit pas venir d'un argot propre à un seul pays. |
| Confiance (10b §3.0 : prix final, dates concrètes, argent bloqué expliqué) | Images de clé, de route, de repère ; un ton clair. Aucun effet d'urgence. |
| Espagnol d'abord, espagnol neutre LATAM, tutoiement (10b §3.3) | Le nom se prononce sans hésiter en espagnol. Il ne doit pas utiliser le *voseo* (fréquent au Paraguay, mais exclu par UX-12). |
| Lisible en anglais (touristes, `en` complet) | Le nom n'a pas de son difficile pour un anglophone (*ll*, *rr*, *ñ*, *j* initial) ou propose une graphie qui le contourne. |
| Concurrence (12 §1.5 et §10 ; 13) | Le nom et l'identité doivent se distinguer des agrégateurs (Kayak, Rentcars, VIP Cars), des loueurs (Localiza, Hertz, Avis, Sixt, Automarket), des acteurs P2P régionaux (TripWip, Drivana, Kovi / Moove) et de Turo. |
| Identité propre (10b §3.0, principe 8) | Aucune reprise de l'identité de Turo (§5). |
| Données de thème (US-034, 10b §8) | Le nom est le paramètre `{brand_name}` et le logo est un SVG stocké dans le thème. Les changer ne demande aucun développement. |

---

## 2. Méthode de contrôle de disponibilité et niveau de certitude

| Contrôle | Méthode (2026-10-31) | Certitude |
|---|---|---|
| `.com` | RDAP du registre Verisign (`rdap.verisign.com`) : 200 = enregistré, 404 = non enregistré | **Bonne** au moment du contrôle. Un domaine libre peut cependant être enregistré à tout moment, ou vendu au prix « premium ». |
| `.app` | RDAP de Google Registry (`pubapi.registry.google/rdap`) | Bonne, avec les mêmes réserves. |
| `.lat` | RDAP de CentralNic (`rdap.centralnic.com/lat`), serveur trouvé grâce au fichier d'amorçage de l'IANA | Bonne, avec les mêmes réserves. |
| `.com.pa` | NIC Panama n'a pas de RDAP public. Nous avons interrogé les serveurs de noms (NS) via un résolveur public : NXDOMAIN signifie « aucun DNS » | **Faible**. Un domaine peut être enregistré sans être délégué. À confirmer sur nic.pa. |
| `.com.py` | Même méthode. Le formulaire de nic.py n'est pas interrogeable automatiquement | **Faible**. À confirmer sur nic.py. |
| Instagram et TikTok | Nous avons tenté d'ouvrir les profils sans être connectés. Les deux sites renvoient la même page qu'un compte existe ou non (mur de connexion) | **Non vérifié**. À contrôler à la main lors de la tâche F-20. |
| Marques | Recherche web rapide (sociétés et applications du même nom ou de secteurs voisins) | **Indicatif seulement : à confirmer par le fondateur** auprès de DIGERPI (Panama) et DINAPI (Paraguay), classes 39 (location de véhicules), 35 et 42. Tâche F-20. |

Contrôle témoin : un nom inventé (`qzxwvk9`) renvoie 404 sur les trois RDAP et NXDOMAIN sur les deux ccTLD. Les méthodes distinguent donc bien « libre » et « pris ».

**Constat** : aucun mot espagnol court et prononçable n'a de `.com` libre, ce qui était attendu. Nous proposons donc pour chaque nom un **domaine principal en `.lat`, `.com.pa` ou `.com.py`** et un **repli en `.com` composé** que nous avons vérifié libre (par exemple `yaveapp.com`).

---

## 3. Les dix noms

Légende : **libre** = non enregistré selon le RDAP du registre ; **pris** = enregistré ; **sans DNS** = aucun serveur de noms, donc probablement libre (non prouvé) ; **DNS actif** = déjà utilisé.

| # | Nom | Prononciation | Sens et justification | Risques (es, guarani, en ; concurrents et grandes marques) | .com | .app | .lat | .com.pa | .com.py | Repli .com libre |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Yave** | « YA-vé » (en : *YAH-vay*) | Graphie phonétique de *llave* (la clé). La remise des clés au comptoir est le moment de confiance du produit et le cœur des écrans agence (A02, A03). Nom court (4 lettres), distinctif, et plus facile à protéger qu'un mot du dictionnaire. | Peut passer pour une faute d'orthographe auprès de certains lecteurs hispanophones. **Yave** (yave.mx) est une fintech hypothécaire mexicaine : autre secteur (classe 36), mais même nom en Amérique latine. Au Paraguay, une partie des locuteurs prononce *ll* différemment de *y* (lleísmo), si bien que le lien avec *llave* y est moins immédiat. Aucun sens négatif connu en guarani ni en anglais. | pris | pris | **libre** | sans DNS | sans DNS | `yaveapp.com`, `yaveautos.com`, `holayave.com` |
| 2 | **Tramo** | « TRA-mo » | Le tronçon de route : chaque location est une étape du voyage. Mot sobre et professionnel, compris dans toute l'Amérique latine et facile à dire en anglais. | Proche à l'oreille de *trampa* (le piège). **TRAMI** est une application argentine de transport avec chauffeur. Comme mot courant, la marque est plus faible. | pris | pris | **libre** | sans DNS | sans DNS | `tramoautos.com` |
| 3 | **Volante** | « vo-LAN-té » | Le volant : *al volante* veut dire « prendre la route ». Compris immédiatement en espagnol et reconnaissable en anglais. | Très descriptif pour la location de voitures, donc une marque faible (risque de refus ou de faible portée en classe 39). « Volante » désigne aussi les versions cabriolet d'Aston Martin. *Volante* veut également dire « prospectus ». | pris | pris | **libre** | sans DNS | sans DNS | `volanteapp.com`, `volanteautos.com` |
| 4 | **Pista** | « PIS-ta » | La piste, et aussi l'indice (*dar una pista*). Court et identique dans les deux langues. | Évoque la course et la vitesse, ce qui va contre la promesse de confiance. Pas de concurrent trouvé. | pris | pris | **libre** | sans DNS | sans DNS | `pistaautos.com` |
| 5 | **Senda** | « SEN-da » | Le sentier : une image douce de chemin sûr. | `senda.com.py` est déjà actif et le `.lat` est pris. L'anglais peut entendre « send a ». Le nom est déjà porté par plusieurs entreprises. | pris | pris | pris | sans DNS | DNS actif | `sendaautos.com` |
| 6 | **Faro** | « FA-ro » | Le phare : un repère et de la confiance. | Ville du Portugal, nom très répandu. `faro.com.py` est actif et aucun repli en `.com` testé n'est libre. | pris | pris | pris | sans DNS | DNS actif | aucun (`faroautos.com` est pris) |
| 7 | **Rumbo** | « ROUM-bo » | Le cap, la direction (*tomar rumbo*). Nom fort. | **Risque élevé** : **Rumbo** (rumbo.es, groupe lastminute.com) est une agence de voyage en ligne qui vend de la location de voitures en espagnol. Le risque de confusion et d'opposition est réel. | pris | pris | **libre** | sans DNS | sans DNS | `rumboautos.com` |
| 8 | **Tranqui** | « TRAN-ki » | « Tranquille » : la promesse d'une location sans surprise. Familier et sympathique. | Trop familier pour séduire des loueurs professionnels. L'anglais le prononce assez mal (*tran-kwee*). | pris | pris | pris | sans DNS | sans DNS | `tranquiautos.com` |
| 9 | **Marcha** | « MAR-tcha » | *En marcha* : en route, ça démarre. | Évoque aussi la manifestation politique. En Espagne, *marcha* veut dire « la fête ». | pris | pris | **libre** | sans DNS | sans DNS | `marchaautos.com` |
| 10 | **Jaha** | « dja-HA » en guarani | « On y va » en guarani (forme inclusive) : un clin d'œil au Paraguay. | Inconnu au Panama. L'espagnol le lit « ja-ja », c'est-à-dire un rire. **Le sens est à valider par un locuteur guarani.** `jaha.com.py` est actif et le `.lat` est pris. | pris | pris | pris | sans DNS | DNS actif | `jahaautos.com` |

Réseaux sociaux : **non vérifiés pour les dix noms**, voir le §2. Marques : **à confirmer par le fondateur (DIGERPI, DINAPI ; F-20)** pour les dix noms.

**Écartés pendant la recherche** (vérifiés, puis rejetés) :
- **Llave** : tous les domaines sont pris (`.com`, `.app`, `.lat`, `.com.py` actif). Yave en est la variante.
- **Clave** : c'est le nom du réseau de débit panaméen.
- **Rutaclara** : trop proche de **Claro**, l'opérateur télécom présent au Panama et au Paraguay, et `.com` / `.app` sont pris.
- **Listo** : Listo Insurance est un assureur automobile américain, et `.com.py` est actif.
- **Brío** : Honda Brio, jouets BRIO.
- **Arranca** : *arrancado* veut dire « fauché » dans plusieurs pays d'Amérique latine.
- **Puente** et **Norte** : `.com.pa` est actif, et les mots sont trop génériques.
- **Rueda** : nom de code ; c'est aussi une appellation de vin espagnole, et la marque serait faible.

### 3.1 Classement et recommandation

Notes sur 5 (5 = meilleur). La « disponibilité » considère qu'un `.lat`, un ccTLD sans DNS et un repli `.com` libres valent mieux que l'absence de domaine.

| Rang | Nom | Sens et confiance | Prononciation es / en | Risque (inverse) | Disponibilité | Total /20 |
|---|---|---|---|---|---|---|
| 1 | Yave | 5 | 4 | 4 | 4 | **17** |
| 2 | Tramo | 4 | 5 | 3 | 4 | **16** |
| 3 | Volante | 4 | 5 | 2 | 4 | **15** |
| 4 | Pista | 3 | 5 | 3 | 4 | 15 |
| 5 | Senda | 4 | 4 | 3 | 2 | 13 |
| 6 | Faro | 4 | 4 | 3 | 1 | 12 |
| 7 | Rumbo | 4 | 4 | 1 | 4 | 13 (rang abaissé : risque éliminatoire) |
| 8 | Tranqui | 3 | 3 | 3 | 3 | 12 |
| 9 | Marcha | 3 | 4 | 2 | 4 | 13 (rang abaissé : connotation politique) |
| 10 | Jaha | 3 | 2 | 2 | 2 | 9 |

**Top 3 recommandé** :
1. **Yave** : c'est le nom le plus distinctif et le plus juste pour un produit centré sur le comptoir. Domaines visés : `yave.lat`, `yave.com.pa` et `yave.com.py` (à confirmer), avec le repli `yaveapp.com`.
2. **Tramo** : le choix le plus sobre et le plus « pro ». Domaines : `tramo.lat`, `.com.pa` et `.com.py` (à confirmer), avec le repli `tramoautos.com`.
3. **Volante** : le nom le plus immédiatement compris, mais aussi le plus difficile à protéger. Domaines : `volante.lat`, avec les replis `volanteapp.com` et `volanteautos.com`.

---

## 4. Trois directions visuelles

Chaque direction est montrée dans `presentation.html` sur **S01** (accueil et recherche), **S03** (fiche véhicule) et **A02** (« Hoy en mostrador »), dans des cadres de téléphone de 360 px, en thème clair et en thème sombre (bouton en haut de la page). Les maquettes appliquent 10b : prix final avec ITBMS dès le départ, bloc « Depósito de garantía » qui nomme l'agence (UX-21, version Bêta), annulation en dates (UX-54), règle des 90 jours en texte fixe (UX-35 Bêta), une seule barre d'action en bas (UX-05), quatre statuts de comptoir (UX-39), aucun bouton désactivé (le bouton « Ver qué falta » remplace un bouton grisé, conformément à UX-50), cibles tactiles de 48 px au moins, et des statuts toujours accompagnés d'une icône et d'un texte (UX-48). Les noms d'agence et de client et les montants sont fictifs.

Le nom affiché dans chaque direction n'est qu'un exemple (Tierra firme avec Yave, Señal avec Tramo, Istmo avec Volante) : **toutes les combinaisons fonctionnent**.

Jetons communs aux trois directions : espacements de 4 à 40 px, cible tactile de 48 px, barre d'action de 72 px, tailles de texte de 13 à 36 px (corps de 17 px), interligne de 1,5. Toutes les polices viennent de **Google Fonts sous licence SIL OFL 1.1**.

### 4.1 Direction A — « Tierra firme » (chaleureuse, artisanale, proche)

- **Concept** : l'agence de quartier qu'on connaît depuis toujours, avec la rigueur d'un service moderne. La terre cuite et le sable rappellent les façades du Casco Viejo et la terre rouge du Paraguay ; le bleu-vert « laguna » sert aux repères (focus, liens secondaires).
- **Logo esquissé** : un anneau de clé et une tige à deux dents qui dessinent un *Y*, avec le mot « yave » en minuscules en Fraunces. SVG dans `tokens-tierra-firme.json → brand.logo`.
- **Palette** :

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| primary | `#A23B1C` | `#F08A64` | action principale, liens |
| surface | `#FBF6EF` | `#1A1411` | fond |
| surface-raised | `#FFFFFF` | `#251D18` | cartes, barre d'action |
| text | `#231B16` | `#F6EEE6` | texte |
| text-muted | `#66564B` | `#C9B8AA` | texte secondaire |
| accent | `#0E6B6B` | `#5CC8C2` | repères, focus |
| success | `#2E6B2F` | `#7BCB7E` | statut positif |
| danger | `#B3261E` | `#FF8A80` | erreur |
| warning | `#875400` | `#F2B84B` | en attente |

- **Typographie** : titres en **Fraunces** 600 (serif à axe optique, voix humaine) ; texte et interface en **Figtree** 400 / 700.
- **Ton** (es, tutoiement) : « Tu precio final ya incluye ITBMS. Lo que ves es lo que pagas. » · « Te escribimos en cuanto la agencia confirme tu reserva. » · « No pudimos cargar los mostradores. Revisa tu conexión y vuelve a intentarlo. »
- **Style photo** : lumière chaude de fin de journée ; vraies personnes au comptoir, des mains qui tendent une clé ; voitures sur des fonds réels, jamais détourées. Pas de photos de banque d'images avec des sourires forcés.
- **Mouvement** : doux, de 160 à 240 ms, courbe ease-out (0.2, 0.7, 0.2, 1). Les feuilles montent de 12 px en fondu ; le prix recalculé « respire » une fois. Tout s'arrête avec `prefers-reduced-motion`.
- **Contrastes WCAG 2.2 AA** (calculés) :

| Paire | Seuil | Clair (couleurs) | Clair | Sombre (couleurs) | Sombre |
|---|---|---|---|---|---|
| texte / surface | 4.5:1 | `#231B16` / `#FBF6EF` | **15.75** OK | `#F6EEE6` / `#1A1411` | **15.88** OK |
| texte / carte | 4.5:1 | `#231B16` / `#FFFFFF` | **16.94** OK | `#F6EEE6` / `#251D18` | **14.43** OK |
| texte secondaire / surface | 4.5:1 | `#66564B` / `#FBF6EF` | **6.52** OK | `#C9B8AA` / `#1A1411` | **9.48** OK |
| texte secondaire / carte | 4.5:1 | `#66564B` / `#FFFFFF` | **7.01** OK | `#C9B8AA` / `#251D18` | **8.61** OK |
| texte du bouton / primaire | 4.5:1 | `#FFFFFF` / `#A23B1C` | **6.61** OK | `#1A1411` / `#F08A64` | **7.40** OK |
| lien primaire / surface | 4.5:1 | `#A23B1C` / `#FBF6EF` | **6.14** OK | `#F08A64` / `#1A1411` | **7.40** OK |
| lien primaire / carte | 4.5:1 | `#A23B1C` / `#FFFFFF` | **6.61** OK | `#F08A64` / `#251D18` | **6.72** OK |
| texte sur accent | 4.5:1 | `#FFFFFF` / `#0E6B6B` | **6.30** OK | `#0B1F1F` / `#5CC8C2` | **8.53** OK |
| succès (texte) / carte | 4.5:1 | `#2E6B2F` / `#FFFFFF` | **6.44** OK | `#7BCB7E` / `#251D18` | **8.43** OK |
| danger (texte) / carte | 4.5:1 | `#B3261E` / `#FFFFFF` | **6.54** OK | `#FF8A80` / `#251D18` | **7.26** OK |
| attention (texte) / carte | 4.5:1 | `#875400` / `#FFFFFF` | **6.37** OK | `#F2B84B` / `#251D18` | **9.26** OK |
| succès / fond succès | 4.5:1 | `#2E6B2F` / `#E5F2E3` | **5.56** OK | `#7BCB7E` / `#1E2E1D` | **7.30** OK |
| danger / fond danger | 4.5:1 | `#B3261E` / `#FBE7E4` | **5.49** OK | `#FF8A80` / `#3A1C19` | **6.76** OK |
| attention / fond attention | 4.5:1 | `#875400` / `#FDF0D8` | **5.65** OK | `#F2B84B` / `#33260F` | **8.23** OK |
| bordure de champ / carte | 3.0:1 | `#8C796B` / `#FFFFFF` | **4.15** OK | `#8C7A6D` / `#251D18` | **4.04** OK |
| anneau de focus / surface | 3.0:1 | `#0E6B6B` / `#FBF6EF` | **5.86** OK | `#5CC8C2` / `#1A1411` | **9.11** OK |
| anneau de focus / carte | 3.0:1 | `#0E6B6B` / `#FFFFFF` | **6.30** OK | `#5CC8C2` / `#251D18` | **8.28** OK |
| composant primaire / surface (1.4.11) | 3.0:1 | `#A23B1C` / `#FBF6EF` | **6.14** OK | `#F08A64` / `#1A1411` | **7.40** OK |

_Info (clair) : accent / surface = 5.86:1 ; border décoratif / carte = 1.40:1 (non utilisé comme contour)._

_Info (sombre) : accent / surface = 9.11:1 ; border décoratif / carte = 1.33:1._

### 4.2 Direction B — « Señal » (précise, signalétique, outil pro)

- **Concept** : la signalétique routière et aéroportuaire : on lit vite et on se trompe peu. Le pétrole profond porte la confiance ; le vert-citron « lima » souligne seulement l'essentiel, en aplat sous un texte foncé. Les étapes sont numérotées (01, 02, 03) et les heures en chasse fixe. C'est la direction la plus naturelle pour le comptoir (A02) et pour les loueurs.
- **Logo esquissé** : un panneau carré dont la barre horizontale et la ligne de voie en pointillés forment un *T*, avec le mot « TRAMO » en Space Grotesk gras.
- **Palette** :

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| primary | `#0B4F6C` | `#6FC3E6` | action principale, liens |
| surface | `#F4F6F7` | `#0B141A` | fond |
| surface-raised | `#FFFFFF` | `#132029` | cartes |
| text | `#0E1A22` | `#EAF2F5` | texte |
| text-muted | `#4A5963` | `#A7B6BE` | texte secondaire |
| accent | `#C8F03C` | `#C8F03C` | surlignage (aplat sous `on-accent`) |
| success | `#1B6B39` | `#5FD38A` | statut positif |
| danger | `#B42318` | `#FF8B7E` | erreur |
| warning | `#855300` | `#F5B94A` | en attente |

- **Règle d'accent** : en thème clair, le citron n'a qu'un contraste de **1,21:1** avec la surface. Il sert donc **uniquement d'aplat sous le texte `on-accent`** (contraste de 13,44:1) et n'est jamais le seul indicateur d'un état ou d'un composant.
- **Typographie** : titres en **Space Grotesk** 700 ; texte en **IBM Plex Sans** 400 / 600 ; heures, codes et libellés en **IBM Plex Mono** 500.
- **Ton** (direct, précis) : « Total: US$ 181.90. Sin cargos al llegar. » · « Pago confirmado. Ya puedes entregar las llaves. » · « Falta firmar el contrato. Ábrelo y pide la firma al cliente. »
- **Style photo** : lumière nette de jour, cadrages réguliers de face et de trois quarts comme une fiche technique, plaque floutée ; au comptoir, l'écran et les mains de l'agent ; fonds neutres réels.
- **Mouvement** : rapide et mécanique, de 120 à 200 ms, sans rebond. Les statuts changent par un fondu de couleur ; la ligne de voie avance pendant les chargements (squelettes). Le mouvement est réduit à des fondus si l'utilisateur le demande.
- **Contrastes WCAG 2.2 AA** (calculés) :

| Paire | Seuil | Clair (couleurs) | Clair | Sombre (couleurs) | Sombre |
|---|---|---|---|---|---|
| texte / surface | 4.5:1 | `#0E1A22` / `#F4F6F7` | **16.29** OK | `#EAF2F5` / `#0B141A` | **16.40** OK |
| texte / carte | 4.5:1 | `#0E1A22` / `#FFFFFF` | **17.65** OK | `#EAF2F5` / `#132029` | **14.62** OK |
| texte secondaire / surface | 4.5:1 | `#4A5963` / `#F4F6F7` | **6.68** OK | `#A7B6BE` / `#0B141A` | **8.92** OK |
| texte secondaire / carte | 4.5:1 | `#4A5963` / `#FFFFFF` | **7.24** OK | `#A7B6BE` / `#132029` | **7.96** OK |
| texte du bouton / primaire | 4.5:1 | `#FFFFFF` / `#0B4F6C` | **8.94** OK | `#0B141A` / `#6FC3E6` | **9.41** OK |
| lien primaire / surface | 4.5:1 | `#0B4F6C` / `#F4F6F7` | **8.25** OK | `#6FC3E6` / `#0B141A` | **9.41** OK |
| lien primaire / carte | 4.5:1 | `#0B4F6C` / `#FFFFFF` | **8.94** OK | `#6FC3E6` / `#132029` | **8.39** OK |
| texte sur accent | 4.5:1 | `#0E1A22` / `#C8F03C` | **13.44** OK | `#0B141A` / `#C8F03C` | **14.16** OK |
| succès (texte) / carte | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK | `#5FD38A` / `#132029` | **8.82** OK |
| danger (texte) / carte | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK | `#FF8B7E` / `#132029` | **7.30** OK |
| attention (texte) / carte | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK | `#F5B94A` / `#132029` | **9.41** OK |
| succès / fond succès | 4.5:1 | `#1B6B39` / `#E2F3E8` | **5.68** OK | `#5FD38A` / `#11281B` | **8.32** OK |
| danger / fond danger | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK | `#FF8B7E` / `#33171A` | **7.23** OK |
| attention / fond attention | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK | `#F5B94A` / `#2E2410` | **8.66** OK |
| bordure de champ / carte | 3.0:1 | `#76868F` / `#FFFFFF` | **3.77** OK | `#6A7F8A` / `#132029` | **3.96** OK |
| anneau de focus / surface | 3.0:1 | `#0B4F6C` / `#F4F6F7` | **8.25** OK | `#C8F03C` / `#0B141A` | **14.16** OK |
| anneau de focus / carte | 3.0:1 | `#0B4F6C` / `#FFFFFF` | **8.94** OK | `#C8F03C` / `#132029` | **12.62** OK |
| composant primaire / surface (1.4.11) | 3.0:1 | `#0B4F6C` / `#F4F6F7` | **8.25** OK | `#6FC3E6` / `#0B141A` | **9.41** OK |

_Info (clair) : accent / surface = 1.21:1 ; border décoratif / carte = 1.38:1 (non utilisé comme contour)._

_Info (sombre) : accent / surface = 14.16:1 ; border décoratif / carte = 1.33:1._

### 4.3 Direction C — « Istmo » (tropicale moderne, lumineuse, accessible)

- **Concept** : l'isthme, un passage entre deux océans, comme la plateforme relie agences et voyageurs. Le vert jungle profond et l'orange mangue donnent de l'optimisme sans faire « carte postale ». La police de texte, **Atkinson Hyperlegible**, a été conçue par le Braille Institute pour les lecteurs malvoyants : c'est un argument d'accessibilité concret. Les grandes surfaces sont arrondies et les gros boutons en forme de pilule ; l'en-tête est de couleur pleine et se termine par une courbe.
- **Logo esquissé** : un cercle de volant avec un *V* à l'intérieur, et le mot « Volante » en Bricolage Grotesque très gras.
- **Palette** :

| Jeton | Clair | Sombre | Usage |
|---|---|---|---|
| primary | `#0F5C4A` | `#5FD0AE` | action principale, en-tête |
| surface | `#FFFBF5` | `#0C1613` | fond |
| surface-raised | `#FFFFFF` | `#15231F` | cartes |
| text | `#13221D` | `#EEF5F1` | texte |
| text-muted | `#4D5E58` | `#A9BBB4` | texte secondaire |
| accent | `#F2873A` | `#FFA45C` | badges, surlignage (aplat sous `on-accent`) |
| success | `#2B6A1E` | `#86D97A` | statut positif |
| danger | `#B3261E` | `#FF8A80` | erreur |
| warning | `#855300` | `#F5B94A` | en attente |

- **Règle d'accent** : en thème clair, le mangue a un contraste de **2,45:1** avec la surface. Il sert donc seulement d'aplat sous `on-accent` (contraste de 7,30:1) et n'est jamais le seul indicateur d'un état.
- **Typographie** : titres en **Bricolage Grotesque** 800 ; texte et interface en **Atkinson Hyperlegible** 400 / 700.
- **Ton** (optimiste, clair) : « Elige tu mostrador y arranca. » · « Cancelación gratuita hasta el jue. 13 ene., 10:00. » · « Listo: tu reserva está confirmada. Te esperamos el vie. 14 ene. a las 10:00. »
- **Style photo** : lumière tropicale franche, ciel et végétation ; la voiture en situation (route côtière, Asunción au crépuscule) ; des touristes et des résidents de profils variés ; saturation naturelle.
- **Mouvement** : vivant mais bref, de 180 à 260 ms. Un léger rebond (0.34, 1.3, 0.64, 1) est réservé aux confirmations. Le mouvement est réduit à des fondus si l'utilisateur le demande.
- **Risque de proximité** : la famille du vert est celle de **Localiza** (premier concurrent et partenaire possible au Paraguay, 13 §R8) ainsi que d'Europcar et d'Enterprise. Le vert d'Istmo est plus sombre et associé au mangue, mais il faudra le vérifier côte à côte avant de choisir.
- **Contrastes WCAG 2.2 AA** (calculés) :

| Paire | Seuil | Clair (couleurs) | Clair | Sombre (couleurs) | Sombre |
|---|---|---|---|---|---|
| texte / surface | 4.5:1 | `#13221D` / `#FFFBF5` | **15.99** OK | `#EEF5F1` / `#0C1613` | **16.64** OK |
| texte / carte | 4.5:1 | `#13221D` / `#FFFFFF` | **16.48** OK | `#EEF5F1` / `#15231F` | **14.68** OK |
| texte secondaire / surface | 4.5:1 | `#4D5E58` / `#FFFBF5` | **6.66** OK | `#A9BBB4` / `#0C1613` | **9.17** OK |
| texte secondaire / carte | 4.5:1 | `#4D5E58` / `#FFFFFF` | **6.87** OK | `#A9BBB4` / `#15231F` | **8.09** OK |
| texte du bouton / primaire | 4.5:1 | `#FFFFFF` / `#0F5C4A` | **7.92** OK | `#0C1613` / `#5FD0AE` | **9.76** OK |
| lien primaire / surface | 4.5:1 | `#0F5C4A` / `#FFFBF5` | **7.69** OK | `#5FD0AE` / `#0C1613` | **9.76** OK |
| lien primaire / carte | 4.5:1 | `#0F5C4A` / `#FFFFFF` | **7.92** OK | `#5FD0AE` / `#15231F` | **8.61** OK |
| texte sur accent | 4.5:1 | `#1B120B` / `#F2873A` | **7.30** OK | `#1B120B` / `#FFA45C` | **9.42** OK |
| succès (texte) / carte | 4.5:1 | `#2B6A1E` / `#FFFFFF` | **6.60** OK | `#86D97A` / `#15231F` | **9.46** OK |
| danger (texte) / carte | 4.5:1 | `#B3261E` / `#FFFFFF` | **6.54** OK | `#FF8A80` / `#15231F` | **7.12** OK |
| attention (texte) / carte | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK | `#F5B94A` / `#15231F` | **9.23** OK |
| succès / fond succès | 4.5:1 | `#2B6A1E` / `#E6F2E1` | **5.70** OK | `#86D97A` / `#16281A` | **9.03** OK |
| danger / fond danger | 4.5:1 | `#B3261E` / `#FBE7E4` | **5.49** OK | `#FF8A80` / `#36191A` | **7.02** OK |
| attention / fond attention | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK | `#F5B94A` / `#2E2410` | **8.66** OK |
| bordure de champ / carte | 3.0:1 | `#7A8A84` / `#FFFFFF` | **3.62** OK | `#667A73` / `#15231F` | **3.56** OK |
| anneau de focus / surface | 3.0:1 | `#0F5C4A` / `#FFFBF5` | **7.69** OK | `#FFA45C` / `#0C1613` | **9.40** OK |
| anneau de focus / carte | 3.0:1 | `#0F5C4A` / `#FFFFFF` | **7.92** OK | `#FFA45C` / `#15231F` | **8.29** OK |
| composant primaire / surface (1.4.11) | 3.0:1 | `#0F5C4A` / `#FFFBF5` | **7.69** OK | `#5FD0AE` / `#0C1613` | **9.76** OK |

_Info (clair) : accent / surface = 2.45:1 ; border décoratif / carte = 1.35:1 (non utilisé comme contour)._

_Info (sombre) : accent / surface = 9.40:1 ; border décoratif / carte = 1.35:1._

### 4.4 Règles communes de contraste

- Seuils appliqués : 4,5:1 pour tout texte, et 3:1 pour les contours de composants et l'anneau de focus (WCAG 1.4.3 et 1.4.11). **Les 108 paires (18 paires × 2 thèmes × 3 directions) passent toutes.** Le calcul utilise la formule de luminance relative WCAG 2.x ; le script est reproductible et les résultats figurent dans `contrastChecks` de chaque JSON.
- Le jeton `border` (environ 1,3 à 1,4:1) sert **seulement aux séparateurs décoratifs**. Tout contour qui identifie un composant (champ, bouton secondaire) utilise `border-strong`.
- L'état n'est jamais indiqué par la couleur seule : chaque pastille a une icône et un texte (UX-48).
- À vérifier ensuite (US-030, US-032) : contrastes des états de survol et d'appui, de la photo sous le badge « 1 / 12 fotos », et du texte agrandi à 200 %.

---

## 5. Contrôle anti-Turo

**Ce que nous savons de l'identité de Turo** (de mémoire et de sources secondaires, sans consulter sa charte officielle ; nous n'avons téléchargé ni copié aucun visuel) : refonte de 2015 par DesignStudio, avec un mot-symbole en lettrage propriétaire sans-serif, en minuscules ; couleur signature dans la famille **violet-indigo** depuis plusieurs années (non confirmé sur source primaire) ; accueil avec une grande photo et une recherche superposée ; cartes de véhicule avec note en étoiles et badges d'hôte (« All-Star Host »). Par prudence, **nous excluons toute teinte entre 230° et 300°** (violets et indigos) des trois palettes.

| Point | Tierra firme | Señal | Istmo |
|---|---|---|---|
| Couleur signature | Primaire terre cuite `#A23B1C` (≈ 14°), accent laguna (≈ 180°). **Conforme** | Primaire pétrole `#0B4F6C` (≈ 198°), accent citron (≈ 74°). **Conforme** | Primaire jungle `#0F5C4A` (≈ 166°), accent mangue (≈ 25°). **Conforme** |
| Logo | Pictogramme de clé formant un Y, et mot-symbole serif. **Conforme** | Panneau carré avec ligne de voie formant un T, et mot-symbole en capitales. **Conforme** | Cercle de volant avec un V, et mot-symbole grotesque gras. **Conforme** |
| Typographie | Fraunces et Figtree (OFL). **Conforme** | Space Grotesk et IBM Plex (OFL). **Conforme** | Bricolage Grotesque et Atkinson Hyperlegible (OFL). **Conforme** |
| Mise en page caractéristique | Recherche dans une carte du flux, sur un motif topographique ; pas de photo plein écran ni de barre de recherche en pilule par-dessus. **Conforme** | Recherche en 3 étapes numérotées avec une ligne de voie ; aucun visuel plein écran. **Conforme** | En-tête de couleur pleine terminé par une courbe, et carte de recherche qui le chevauche ; pas de photo plein écran. **Conforme** |
| Libellés et programmes | Aucun (« Nuevo · sin reseñas » et nombre de trips, 10b REV-010). **Conforme** | Aucun ; nos statuts de comptoir (UX-39). **Conforme** | Aucun ; badge « Nuevo » qui est le nôtre. **Conforme** |
| Fiche véhicule | Aucune note en étoiles ni badge d'hôte ; prix final et caution **avant** les avis (10b AM13). **Conforme** | Idem. **Conforme** | Idem. **Conforme** |

Le relecteur UX indépendant devra confirmer ce contrôle visuellement.

---

## 6. Nom et logo comme données de thème (US-034) et passage à US-030

- Chaque `tokens-<direction>.json` suit le **format DTCG** (brouillon du W3C Community Group) : `color.light` et `color.dark` (18 jetons chacun), `font`, `space`, `size`, `radius`, `shadow`, `motion`, `brand` et `contrastChecks`.
- `brand.name` vaut `{brand_name}` (paramètre) ; `brand.exampleName` donne le nom des maquettes ; `brand.logo` contient le SVG du logo, en `currentColor` pour suivre le thème.
- US-030 pourra compiler ces fichiers en variables CSS et réutiliser `contrastChecks` comme jeu de tests de son contrôle de contraste.

---

## 7. Grille de choix du fondateur

**Choisir 1 nom + 1 direction.** Les combinaisons sont libres.

| Choix | Options | Recommandation |
|---|---|---|
| Nom | Yave · Tramo · Volante · Pista · Senda · Faro · Rumbo · Tranqui · Marcha · Jaha · un autre nom | **Yave** |
| Direction | A « Tierra firme » · B « Señal » · C « Istmo » | Selon votre préférence. **Señal** sert le mieux le comptoir et les loueurs ; **Istmo** est la plus mémorable pour les voyageurs et la plus forte en accessibilité ; **Tierra firme** est la plus chaleureuse. |
| Ajustements | Couleur, police, nom en minuscules ou en capitales, etc. | Possibles sans développement après US-030 et US-034 |

**Défaut en attendant le choix (DEC-MARQUE)** : le nom reste le paramètre **`{brand_name}`** et l'application utilise un **thème neutre accessible**. US-030 peut démarrer avec ce thème et basculer ensuite sans développement.

**Après le choix** :
1. Consigner le choix dans le journal des décisions (DEC-MARQUE, alimente US-030).
2. **F-20 (fondateur)** : recherche d'antériorité DIGERPI et DINAPI (classes 39, 35 et 42), achat des domaines (`.lat`, `.com.pa`, `.com.py` et le repli `.com`), réservation des comptes Instagram et TikTok, **avant** toute publication du nom.
3. Faire relire le nom et la microcopie par une personne panaméenne et une personne paraguayenne (et, pour Jaha, par un locuteur guarani).

---

## 8. Incertitudes

- Disponibilité des `.com.pa` et `.com.py` déduite seulement de l'absence de DNS ; réseaux sociaux non vérifiés.
- Marques : aucune recherche dans les bases officielles. Il ne s'agit que d'une recherche web.
- Identité de Turo décrite de mémoire et d'après des sources secondaires. L'exclusion de toute la zone violet-indigo couvre ce doute.
- Le sens de « Jaha » et la prononciation de « Yave » au Paraguay restent à valider auprès de locuteurs.
- Maquettes : elles ne sont pas testées avec un lecteur d'écran, et le rendu des polices dépend du chargement de Google Fonts.
