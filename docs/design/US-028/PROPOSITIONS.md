# US-028 — Naming et identité : propositions pour le choix du fondateur

- **Story** : US-028 (epic E16, DSN-001), lot 0
- **Rôle** : agent DESIGN
- **Date** : 2026-10-31
- **Statut** : nom **Kmino** tranché par le fondateur le 2026-11-02 (DEC-MARQUE). Direction : **à choisir** parmi les quatre palettes claires du 2026-11-02 (Cielo, Marina, Voltio, Lagune) et les trois variantes « blanc épuré » Lienzo (Tinta, Azur, Grafito) ; **Cielo** est le défaut **PROPOSÉ** en attendant. Tierra firme, Señal et Istmo ont été écartées par le fondateur le 2026-11-02 (« trop sombre »). Voir « Choix du fondateur (2026-11-02) » et « Palettes claires (2026-11-02) ».
- **Références** : 19 §1.6 et US-028 ; 10b §2, §3.0 (principe 8 « identité propre »), §3.3, §3.10, §4 (S01, S03, A02), §8 ; 12 §1.5 et §10 ; 13 (concurrence).
- **Fichiers** : ce document ; `presentation.html` (page visuelle avec les maquettes) ; `tokens-cielo.json`, `tokens-marina.json`, `tokens-voltio.json` et `tokens-lagune.json` (palettes claires, jetons prêts pour US-030) ; `tokens-lienzo-tinta.json`, `tokens-lienzo-azur.json` et `tokens-lienzo-grafito.json` (famille blanc épuré) ; `tokens-tierra-firme.json`, `tokens-senal.json` et `tokens-istmo.json` (anciennes directions, écartées, gardées pour mémoire).

> **En 30 secondes.** Le nom est choisi : **Kmino**. Il reste à choisir la direction visuelle. Après le retour du fondateur du 2026-11-02 (« trop sombre »), quatre palettes claires sont proposées : **Cielo** (monochrome bleu ciel, lumineux), **Marina** (bleu marine et sable, sobre et premium), **Voltio** (blanc, bleu électrique et noir, graphique) et **Lagune** (bleu lagon et corail, frais). À la demande du fondateur, trois variantes **blanc épuré** s'y ajoutent : **Lienzo · Tinta** (encre bleu nuit), **Lienzo · Azur** (bleu azur doux) et **Lienzo · Grafito** (graphite et titres serif). Nous recommandons **Cielo** par défaut (PROPOSÉ). Les maquettes montrent une location **entre particuliers** : des personnes louent leur propre auto (voir « Positionnement entre particuliers »). La page s'ouvre en thème clair sur **Lienzo · Azur**. Pour voir les écrans, ouvrez `presentation.html` : un sélecteur passe d'une direction à l'autre. Les dix noms et les trois anciennes directions restent plus bas pour mémoire.

---

## Choix du fondateur (2026-11-02)

| Décision           | Valeur                             | Statut                                                                                                                                                                                                             |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nom (DEC-MARQUE)   | **Kmino** (de _camino_ et de _km_) | **Tranché par le fondateur** le 2026-11-02 (« je veux partir sur K-mino au pire je rechangerais après »), puis corrigé le même jour en « Kmino », sans tiret. Révisable : le nom est une donnée de thème (US-034). |
| Direction visuelle | **Cielo** (« Palettes claires »)   | **PROPOSÉ**, en attente du choix du fondateur parmi Cielo, Marina, Voltio et Lagune. Le 2026-11-02, le fondateur a écarté Tierra firme, Señal et Istmo, jugées trop sombres ; Señal n'est plus le défaut.          |
| Publication du nom | Bloquée jusqu'à F-20               | La recherche d'antériorité DIGERPI (Panama) et DINAPI (Paraguay), en classes 39, 35 et 42, reste à faire **par le fondateur** avant toute publication.                                                             |

Kmino ne figurait pas parmi les dix noms du §3. Il remplace Yave, Tramo et Volante, qui restent dans ce document pour mémoire.

### Graphie retenue (règle)

| Usage                                    | Forme                                                                           | Règle                                                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom officiel, dans le texte (es, en, fr) | **Kmino**                                                                       | Un seul mot, _K_ majuscule, le reste en minuscules. Jamais « K-mino », « K·mino », « KMino » ni « kmino » dans une phrase. En capitales (signalétique, libellés en Plex Mono) : « KMINO ».              |
| Logotype (toutes directions)             | _K_ en `primary` et « mino » en `text`, police de titre, précédé du pictogramme | La coupure _K_ / _mino_ n'est montrée **que par le dessin** (la couleur ; la graisse peut aussi servir). Aucun tiret ni point médian dans le logotype : le mot écrit et le mot dessiné sont identiques. |
| Identifiant technique                    | `kmino`                                                                         | Domaines, comptes de réseaux, noms de paquets, clés de thème et de traduction. Minuscules, sans tiret.                                                                                                  |
| Paramètre                                | `{brand_name}` = `Kmino`                                                        | Le code n'écrit jamais le nom en dur (`tokens-senal.json → brand`).                                                                                                                                     |
| Prononciation                            | « ka-MI-no » (en : _kah-MEE-no_)                                                | Accent sur la deuxième syllabe, comme dans _camino_.                                                                                                                                                    |

**Pictogramme (ancienne direction Señal, pour mémoire ; chaque palette claire a le sien, voir plus bas)** : un panneau routier carré porte un _K_ ; dessous, une ligne de voie en pointillés rappelle la borne kilométrique. En thème clair, le _K_ est blanc sur pétrole et la ligne est citron (6,80:1 sur `primary`). En thème sombre, le _K_ et la ligne sont en `on-primary` (9,41:1) : le citron n'y est pas utilisé, car il n'atteint que 1,50:1 sur le pétrole clair. Le JSON contient les deux variantes (`brand.logo` et `brand.logoDark`), ce qui règle aussi la remarque 5 de la revue UX du 2026-10-31.

### Risques connus et parades

Le fondateur connaît ces risques et a choisi le nom en les acceptant.

| Risque                                          | Parade proposée                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecture « que-mino » (en SMS, _k_ se lit _que_) | Donner la prononciation là où le nom apparaît pour la première fois (accueil, page « Quiénes somos », dossier de presse) ; pictogramme qui isole le _K_ ; tout message parlé (vidéo, support client) dit « ka-MI-no ».                                                                        |
| Recherche orale de « camino »                   | _Camino_ est un mot du dictionnaire, impossible à protéger : viser plutôt le référencement sur « camino alquiler de autos » et sur les fautes « kamino » et « k-mino ». Rediriger les domaines `k-mino.*` vers `kmino.*`.                                                                     |
| Le tiret embrouille domaines et pseudos         | Un seul identifiant, `kmino`, partout. Acheter aussi les variantes `k-mino` disponibles et les rediriger.                                                                                                                                                                                     |
| Le nom évoque la route plus que la location     | Une signature qui dit la location entre particuliers : « Kmino · Alquila el auto de un vecino. » / « Rent a car from a neighbor. » (voir « Positionnement entre particuliers »). Les idées « Alquila tu auto… » et « Compara agencias… » sont abandonnées. À relire au Panama et au Paraguay. |
| Homonymes existants (voir ci-dessous)           | Aucun conflit trouvé dans la location de véhicules. Les homonymes sont dans d'autres secteurs, mais l'un d'eux (une application de sport avec suivi GPS) touche à la mobilité : à examiner pendant F-20.                                                                                      |

### Recherche rapide d'homonymes (2026-11-02)

Recherche web en lecture seule, sans compte ni identifiant. Elle est **indicative** et ne remplace pas F-20.

| Nom trouvé                | Secteur, pays                                                                                                                                                        | Proximité                                                                                          | Risque estimé                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Kmino** (`kmino.app`)   | Application sur invitation pour marcher, courir et pédaler (suivi GPS, partage de parcours) ; site en portugais, pays non indiqué. Domaine enregistré le 2026-09-30. | Nom identique ; secteur voisin (mobilité personnelle, classes 9 et 42 probables), pas la location. | **Moyen**. Projet très récent : vérifier s'il dépose une marque, et dans quels pays.    |
| **k-mino** (`k-mino.com`) | Éditeur français de logiciels d'études et de sondages (Paris).                                                                                                       | Nom identique avec tiret ; autre secteur (classes 9 et 42).                                        | Faible en classe 39, mais le `.com` avec tiret est pris.                                |
| **Kamino**                | Fintech américano-brésilienne (`kamino.com`) ; jeton crypto KMNO (Kamino Finance, Solana) ; application de balades « Kamino » de 2014, apparemment inactive.         | Même son, autre graphie, autres secteurs.                                                          | Faible. Brouille la recherche « kamino ».                                               |
| **Camino** (applications) | _Camino Maps_ (App Store du Paraguay), _Caminos_ (App Store du Honduras), _Camino Nomad_ ; nombreuses applications du chemin de Compostelle.                         | Même racine ; navigation et voyage.                                                                | Faible à moyen : bruit sur la recherche « camino ». Aucun acteur de la location trouvé. |
| **Kinto** (Toyota)        | Location et autopartage, présent en Amérique latine.                                                                                                                 | Ressemblance visuelle seulement (« K…ino »).                                                       | Faible. À garder en tête pour la couleur et le ton.                                     |

Aucune entreprise de location de véhicules nommée Kmino, K-mino, Kamino ou Camino n'a été trouvée au Panama, au Paraguay ou ailleurs en Amérique latine. **Incertitude** : la recherche web couvre mal les petites entreprises locales et ne consulte aucune base de marques. DIGERPI et DINAPI (F-20) font foi.

### Domaines (contrôle du 2026-11-02, même méthode qu'au §2)

| Domaine                                           | Résultat   | Détail                                                                                                                                                                                                | Certitude                       |
| ------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `kmino.com`                                       | **pris**   | Enregistré en 2004 ; serveurs de noms Afternic ; le site redirige vers une page « à vendre » de GoDaddy (prix non affiché). Rachat possible sur le marché secondaire, sans doute au prix « premium ». | Bonne (RDAP Verisign)           |
| `k-mino.com`                                      | **pris**   | Enregistré en 2016 ; utilisé par l'éditeur français cité plus haut.                                                                                                                                   | Bonne                           |
| `kmino.app`                                       | **pris**   | Enregistré le 2026-09-30 ; utilisé par l'application de sport citée plus haut.                                                                                                                        | Bonne (RDAP Google Registry)    |
| `k-mino.app`                                      | **libre**  | RDAP 404                                                                                                                                                                                              | Bonne                           |
| `kmino.lat`                                       | **libre**  | RDAP 404                                                                                                                                                                                              | Bonne (RDAP CentralNic)         |
| `k-mino.lat`                                      | **libre**  | RDAP 404                                                                                                                                                                                              | Bonne                           |
| `kmino.com.pa`, `k-mino.com.pa`                   | sans DNS   | aucun serveur de noms                                                                                                                                                                                 | Faible : à confirmer sur nic.pa |
| `kmino.com.py`, `k-mino.com.py`                   | sans DNS   | aucun serveur de noms                                                                                                                                                                                 | Faible : à confirmer sur nic.py |
| `kminoapp.com`, `kminoautos.com`, `kminorent.com` | **libres** | RDAP 404                                                                                                                                                                                              | Bonne                           |

Contrôles témoins refaits : `qzxwvk9.com` renvoie 404 et `google.com` renvoie 200 ; `qzxwvk9.com.pa` et `qzxwvk9.com.py` n'ont pas de DNS.

**Domaines à acheter (F-20, fondateur)** : `kmino.lat`, `kmino.com.pa`, `kmino.com.py` et un repli en `.com` (`kminoapp.com` ou `kminoautos.com`), plus les variantes `k-mino.lat`, `k-mino.app`, `k-mino.com.pa` et `k-mino.com.py` à rediriger. En option : une offre pour `kmino.com` sur le marché secondaire. Réseaux sociaux (`@kmino`) : **non vérifiés**, pour la même raison qu'au §2.

### Points pour le fondateur

1. Choisir la direction parmi les quatre palettes claires et les trois variantes Lienzo (**Cielo** reste le défaut PROPOSÉ) : le nom fonctionne avec les sept.
2. F-20, avant toute publication : DIGERPI et DINAPI (classes 39, 35 et 42), achat des domaines ci-dessus, pseudos Instagram et TikTok `kmino`.
3. Choisir la signature parmi les trois options de « Positionnement entre particuliers » (la 1 est recommandée), puis la faire relire au Panama et au Paraguay. L'encaissement suit DEC-FONDATEUR-14 (défaut PROPOSÉ, voir « Encaissement »).
4. Décider s'il faut tenter de racheter `kmino.com` (à vendre, prix inconnu).

---

## Palettes claires (2026-11-02) : quatre nouvelles directions

**Retour du fondateur (2026-11-02)** : les trois directions du 31 octobre sont « trop sombres ». Il veut des palettes **claires**, avec des variations, dans l'esprit du blanc, du bleu et du noir, mais **sans obligation de combiner ces trois couleurs** : un code couleur joli et logique, au ton clair. Nous proposons quatre directions nettement différentes ; chacune a sa logique de palette en une phrase.

Règles communes aux quatre : beaucoup de blanc et des surfaces très claires (le thème clair est la vitrine) ; **le bleu porte l'action** (bouton principal, liens, focus en clair) ; aucun accent purement décoratif (l'accent marque une mise en avant ou une sélection, toujours en aplat sous un texte qui contraste) ; bleus francs entre 195° et 225°, rien dans la zone violet-indigo (230° à 300°) ; statuts toujours avec icône et texte ; cibles tactiles de 48 px ; thème sombre fourni pour l'accessibilité. Polices Google Fonts sous licence SIL OFL 1.1.

| Direction               | Bleu principal (clair / sombre) | Logique de la palette                                                                                                                                                                                   | Police                   |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Cielo** (recommandée) | `#096CAA` / `#86CDF9`           | Monochrome nuancé : une seule teinte (bleu ciel, ≈ 203°) déclinée du blanc bleuté (50) à l'encre bleu nuit (900), sans couleur concurrente ; les états gardent leurs couleurs propres.                  | Plus Jakarta Sans        |
| **Marina**              | `#1A3F70` / `#98BAE7`           | Complémentaire doux : un bleu marine froid (≈ 214°) équilibré par des neutres sable chauds (≈ 40°) ; le sable reste en aplats clairs, le marine porte toute l'action.                                   | Newsreader + Inter       |
| **Voltio**              | `#0A5CFF` / `#5C8DFF`           | Achromatique + une seule couleur saturée : blanc, gris et noir neutres (sans teinte) et un bleu électrique (≈ 220°) réservé à l'action ; le noir sert de contraste fort (onglet actif, numéros, focus). | Archivo + JetBrains Mono |
| **Lagune**              | `#0A6F94` / `#89D9F5`           | Complémentaire : un bleu lagon (≈ 196°) et un corail doux (≈ 12°), opposés sur le cercle ; le corail reste un aplat clair de mise en avant, le bleu porte l'action.                                     | Outfit + Source Sans 3   |

**Recommandation (PROPOSÉ) : Cielo.** C'est la plus claire et la plus simple à tenir : une seule teinte, donc le bleu ne sert qu'à agir et rien ne lui fait concurrence ; elle est accueillante pour les voyageurs et nette dans l'espace hôte (A02) ; elle laisse la place aux photos de véhicules. Marina est plus haut de gamme, Voltio plus contrastée et plus « tech », Lagune plus souriante. Le choix revient au fondateur.

### D — « Cielo » (lumineux, aérien, accueillant)

- **Concept** : Le ciel clair du Pacifique et des grandes plaines du Chaco : beaucoup de blanc, un bleu ciel franc qui ne sert qu'à agir, une encre bleu nuit pour lire. Le voyageur se sent attendu, l'hôte garde un outil net.
- **Logique de la palette** : Monochrome nuancé : une seule teinte (bleu ciel, ≈ 203°) déclinée du blanc bleuté (50) à l'encre bleu nuit (900), sans couleur concurrente ; les états gardent leurs couleurs propres.
- **Logo esquissé** : Un disque bleu ciel porte un K blanc ; dessous, une courbe d'horizon (la route qui s'ouvre). Le mot « Kmino » en Plus Jakarta Sans 800, le K en bleu. SVG clair et sombre dans `tokens-cielo.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#F0F9FE` · 100 `#DDF1FD` · 200 `#B6E1FB` · 300 `#86CDF9` · 400 `#4CB4F6` · 500 `#169EF3` · 600 `#0B85D0` · 700 `#096CAA` · 800 `#075383` · 900 `#053B5C`.
- **Nuances neutres** (50 → 900) : 50 `#F7FBFE` · 100 `#EAF4FB` · 200 `#D6E4EE` · 300 `#B4C7D5` · 400 `#7890A2` · 500 `#5E7587` · 600 `#4A6072` · 700 `#344A5B` · 800 `#1E3242` · 900 `#0B1E2D`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#096CAA` | `#86CDF9` |
| on-primary     | `#FFFFFF` | `#06121C` |
| surface        | `#F7FBFE` | `#0A1622` |
| surface-raised | `#FFFFFF` | `#112130` |
| surface-sunken | `#EAF4FB` | `#06101A` |
| text           | `#0B1E2D` | `#EAF4FB` |
| text-muted     | `#4A6072` | `#A9BED0` |
| border         | `#D6E4EE` | `#22374A` |
| border-strong  | `#7890A2` | `#64819A` |
| accent         | `#DDF1FD` | `#0E3552` |
| on-accent      | `#053B5C` | `#D6EEFD` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#096CAA` | `#86CDF9` |

- **Règle d'accent** : L'accent est le bleu 100 (#DDF1FD) : un aplat clair sous texte bleu nuit pour les bandeaux et les sélections, jamais un indicateur seul (1,12:1 avec la surface).
- **Typographie** : Plus Jakarta Sans 800 (titres) · 400/600 (texte) · chiffres tabulaires.
- **Ton** (es, tutoiement) : « Tu precio final ya incluye ITBMS. » · « Listo: tu auto te espera el vie. 14 ene. a las 10:00. » · « No pudimos cargar los autos cercanos. Revisa tu conexión y vuelve a intentarlo. »
- **Style photo** : Lumière de matin, ciel dégagé, beaucoup d'air autour du véhicule ; vraies scènes de remise entre voisins (sans visage reconnaissable) ; tons naturels, sans filtre bleu ajouté.
- **Mouvement** : Doux et bref : 150 à 260 ms, courbe ease-out. Les feuilles montent de 12 px en fondu ; aucun rebond. Tout s'arrête avec prefers-reduced-motion.
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 10 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#0B1E2D` / `#F7FBFE` | **16.31** OK | `#EAF4FB` / `#0A1622` | **16.36** OK |
| texte / carte                                        | 4.5:1 | `#0B1E2D` / `#FFFFFF` | **16.97** OK | `#EAF4FB` / `#112130` | **14.67** OK |
| texte secondaire / surface                           | 4.5:1 | `#4A6072` / `#F7FBFE` | **6.29** OK  | `#A9BED0` / `#0A1622` | **9.53** OK  |
| texte secondaire / carte                             | 4.5:1 | `#4A6072` / `#FFFFFF` | **6.55** OK  | `#A9BED0` / `#112130` | **8.54** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#096CAA` | **5.62** OK  | `#06121C` / `#86CDF9` | **10.90** OK |
| lien primaire / surface                              | 4.5:1 | `#096CAA` / `#F7FBFE` | **5.40** OK  | `#86CDF9` / `#0A1622` | **10.53** OK |
| lien primaire / carte                                | 4.5:1 | `#096CAA` / `#FFFFFF` | **5.62** OK  | `#86CDF9` / `#112130` | **9.43** OK  |
| texte / accent                                       | 4.5:1 | `#053B5C` / `#DDF1FD` | **10.12** OK | `#D6EEFD` / `#0E3552` | **10.61** OK |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#112130` | **8.70** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#112130` | **7.20** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#112130` | **9.28** OK  |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#7890A2` / `#FFFFFF` | **3.33** OK  | `#64819A` / `#112130` | **4.01** OK  |
| anneau de focus / surface                            | 3.0:1 | `#096CAA` / `#F7FBFE` | **5.40** OK  | `#86CDF9` / `#0A1622` | **10.53** OK |
| anneau de focus / carte                              | 3.0:1 | `#096CAA` / `#FFFFFF` | **5.62** OK  | `#86CDF9` / `#112130` | **9.43** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#096CAA` / `#F7FBFE` | **5.40** OK  | `#86CDF9` / `#0A1622` | **10.53** OK |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#096CAA` | **5.62** OK  | `#06121C` / `#86CDF9` | **10.90** OK |
| logo : repère / pictogramme                          | 3.0:1 | `#FFFFFF` / `#096CAA` | **5.62** OK  | `#06121C` / `#86CDF9` | **10.90** OK |
| logotype : K / surface                               | 3.0:1 | `#096CAA` / `#F7FBFE` | **5.40** OK  | `#86CDF9` / `#0A1622` | **10.53** OK |
| texte / fond en retrait                              | 4.5:1 | `#0B1E2D` / `#EAF4FB` | **15.21** OK | `#EAF4FB` / `#06101A` | **17.17** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#4A6072` / `#EAF4FB` | **5.87** OK  | `#A9BED0` / `#06101A` | **10.00** OK |
| lien primaire / fond en retrait                      | 4.5:1 | `#096CAA` / `#EAF4FB` | **5.04** OK  | `#86CDF9` / `#06101A` | **11.05** OK |
| texte / bandeau d'accueil                            | 4.5:1 | `#0B1E2D` / `#DDF1FD` | **14.60** OK | `#EAF4FB` / `#0E3552` | **11.41** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#096CAA` / `#DDF1FD` | **4.84** OK  | `#86CDF9` / `#0E3552` | **7.34** OK  |
| surface / texte (onglet actif)                       | 4.5:1 | `#F7FBFE` / `#0B1E2D` | **16.31** OK | `#0A1622` / `#EAF4FB` | **16.36** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#096CAA` / `#EAF4FB` | **5.04** OK  | `#86CDF9` / `#06101A` | **11.05** OK |

_Info : accent / surface = 1.12:1 (clair) et 1.43:1 (sombre) ; border décoratif / carte = 1.30:1 et 1.33:1 (jamais utilisé comme contour)._

### E — « Marina » (sobre, premium, rassurant)

- **Concept** : Le port et la marine marchande : un bleu marine profond pour la confiance, posé sur un blanc cassé chaud couleur sable. Une élégance discrète, qui inspire le sérieux aux hôtes et aux voyageurs d'affaires.
- **Logique de la palette** : Complémentaire doux : un bleu marine froid (≈ 214°) équilibré par des neutres sable chauds (≈ 40°) ; le sable reste en aplats clairs, le marine porte toute l'action.
- **Logo esquissé** : Un carré marine aux angles à peine arrondis porte un K fin, souligné d'un trait sable (la ligne de flottaison). « Kmino » en Newsreader 600. SVG clair et sombre dans `tokens-marina.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#F3F7FC` · 100 `#E2ECF8` · 200 `#C1D6F0` · 300 `#98BAE7` · 400 `#6699DB` · 500 `#397AD0` · 600 `#2A65B2` · 700 `#225291` · 800 `#1A3F70` · 900 `#122C4E`.
- **Nuances sable** (50 → 900) : 50 `#FBF9F5` · 100 `#F3EEE4` · 200 `#EBD9B0` · 300 `#D9BC7E` · 400 `#BE9A55` · 500 `#9C7A3A` · 600 `#7A5E2B` · 700 `#5A451F` · 800 `#3C2E15` · 900 `#211A0C`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#1A3F70` | `#98BAE7` |
| on-primary     | `#FFFFFF` | `#0B1320` |
| surface        | `#FBF9F5` | `#0B1320` |
| surface-raised | `#FFFFFF` | `#141E2E` |
| surface-sunken | `#F3EEE4` | `#070D17` |
| text           | `#141B26` | `#F1EEE8` |
| text-muted     | `#545B66` | `#B5B2AA` |
| border         | `#E6DFD2` | `#283244` |
| border-strong  | `#8A8478` | `#757C88` |
| accent         | `#EBD9B0` | `#D9BC7E` |
| on-accent      | `#122C4E` | `#0B1320` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#1A3F70` | `#D9BC7E` |

- **Règle d'accent** : Le sable (#EBD9B0) sert d'aplat sous texte marine pour mettre en avant une information (prix final, nouveauté) ; il n'est jamais seul indicateur (1,32:1 avec la surface).
- **Typographie** : Newsreader 600 (titres) · Inter 400/600 (texte, chiffres tabulaires).
- **Ton** (es, tutoiement) : « El precio que ves es el que pagas. » · « Tu reserva está confirmada. Carlos te espera el vie. 14 ene. » · « Falta firmar el contrato. Ábrelo y pide la firma al cliente. »
- **Style photo** : Lumière douce et dorée, cadrages calmes et symétriques ; matières (cuir, tableau de bord) ; fonds urbains réels, peu saturés.
- **Mouvement** : Posé : 150 à 300 ms, courbe standard, sans rebond ; fondus et glissements courts. Réduit à des fondus si l'utilisateur le demande.
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 10 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#141B26` / `#FBF9F5` | **16.44** OK | `#F1EEE8` / `#0B1320` | **16.07** OK |
| texte / carte                                        | 4.5:1 | `#141B26` / `#FFFFFF` | **17.29** OK | `#F1EEE8` / `#141E2E` | **14.45** OK |
| texte secondaire / surface                           | 4.5:1 | `#545B66` / `#FBF9F5` | **6.52** OK  | `#B5B2AA` / `#0B1320` | **8.79** OK  |
| texte secondaire / carte                             | 4.5:1 | `#545B66` / `#FFFFFF` | **6.85** OK  | `#B5B2AA` / `#141E2E` | **7.90** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#1A3F70` | **10.56** OK | `#0B1320` / `#98BAE7` | **9.32** OK  |
| lien primaire / surface                              | 4.5:1 | `#1A3F70` / `#FBF9F5` | **10.04** OK | `#98BAE7` / `#0B1320` | **9.32** OK  |
| lien primaire / carte                                | 4.5:1 | `#1A3F70` / `#FFFFFF` | **10.56** OK | `#98BAE7` / `#141E2E` | **8.38** OK  |
| texte / accent                                       | 4.5:1 | `#122C4E` / `#EBD9B0` | **10.08** OK | `#0B1320` / `#D9BC7E` | **10.14** OK |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#141E2E` | **8.90** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#141E2E` | **7.37** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#141E2E` | **9.50** OK  |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#8A8478` / `#FFFFFF` | **3.72** OK  | `#757C88` / `#141E2E` | **3.98** OK  |
| anneau de focus / surface                            | 3.0:1 | `#1A3F70` / `#FBF9F5` | **10.04** OK | `#D9BC7E` / `#0B1320` | **10.14** OK |
| anneau de focus / carte                              | 3.0:1 | `#1A3F70` / `#FFFFFF` | **10.56** OK | `#D9BC7E` / `#141E2E` | **9.12** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#1A3F70` / `#FBF9F5` | **10.04** OK | `#98BAE7` / `#0B1320` | **9.32** OK  |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#1A3F70` | **10.56** OK | `#0B1320` / `#98BAE7` | **9.32** OK  |
| logo : repère / pictogramme                          | 3.0:1 | `#EBD9B0` / `#1A3F70` | **7.58** OK  | `#0B1320` / `#98BAE7` | **9.32** OK  |
| logotype : K / surface                               | 3.0:1 | `#1A3F70` / `#FBF9F5` | **10.04** OK | `#98BAE7` / `#0B1320` | **9.32** OK  |
| texte / fond en retrait                              | 4.5:1 | `#141B26` / `#F3EEE4` | **14.95** OK | `#F1EEE8` / `#070D17` | **16.81** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#545B66` / `#F3EEE4` | **5.92** OK  | `#B5B2AA` / `#070D17` | **9.19** OK  |
| lien primaire / fond en retrait                      | 4.5:1 | `#1A3F70` / `#F3EEE4` | **9.13** OK  | `#98BAE7` / `#070D17` | **9.74** OK  |
| texte / bandeau d'accueil                            | 4.5:1 | `#141B26` / `#F3EEE4` | **14.95** OK | `#F1EEE8` / `#070D17` | **16.81** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#1A3F70` / `#F3EEE4` | **9.13** OK  | `#98BAE7` / `#070D17` | **9.74** OK  |
| surface / texte (onglet actif)                       | 4.5:1 | `#FBF9F5` / `#141B26` | **16.44** OK | `#0B1320` / `#F1EEE8` | **16.07** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#1A3F70` / `#F3EEE4` | **9.13** OK  | `#98BAE7` / `#070D17` | **9.74** OK  |

_Info : accent / surface = 1.32:1 (clair) et 10.14:1 (sombre) ; border décoratif / carte = 1.32:1 et 1.30:1 (jamais utilisé comme contour)._

### F — « Voltio » (graphique, rapide, tech)

- **Concept** : Le blanc pur d'un écran bien réglé, un bleu électrique pour chaque action et le noir pour la structure : contraste maximal, lecture immédiate au soleil, au moment de la remise des clés.
- **Logique de la palette** : Achromatique + une seule couleur saturée : blanc, gris et noir neutres (sans teinte) et un bleu électrique (≈ 220°) réservé à l'action ; le noir sert de contraste fort (onglet actif, numéros, focus).
- **Logo esquissé** : Un carré bleu électrique porte un K blanc épais ; un petit carré noir dans l'angle marque la borne (km). « Kmino » en Archivo 800, le K en bleu. SVG clair et sombre dans `tokens-voltio.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#F0F5FF` · 100 `#DBE7FF` · 200 `#B2CCFF` · 300 `#80AAFF` · 400 `#4281FF` · 500 `#0A5CFF` · 600 `#0049DB` · 700 `#003BB2` · 800 `#002E8A` · 900 `#002061`.
- **Nuances neutres** (50 → 900) : 50 `#FFFFFF` · 100 `#F2F3F5` · 200 `#E3E4E8` · 300 `#C6C7CD` · 400 `#8A8B93` · 500 `#6C6D74` · 600 `#55565C` · 700 `#3A3B40` · 800 `#202124` · 900 `#0A0A0B`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#0A5CFF` | `#5C8DFF` |
| on-primary     | `#FFFFFF` | `#0A0A0B` |
| surface        | `#FFFFFF` | `#0A0A0B` |
| surface-raised | `#FFFFFF` | `#151517` |
| surface-sunken | `#F2F3F5` | `#000000` |
| text           | `#0A0A0B` | `#F4F4F5` |
| text-muted     | `#55565C` | `#A8A9B0` |
| border         | `#E3E4E8` | `#2A2B30` |
| border-strong  | `#0A0A0B` | `#8A8B93` |
| accent         | `#0A0A0B` | `#F4F4F5` |
| on-accent      | `#FFFFFF` | `#0A0A0B` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#0A0A0B` | `#5C8DFF` |

- **Règle d'accent** : L'accent est le noir (#0A0A0B) : aplat sous texte blanc pour l'onglet actif et les numéros d'étape. Ce n'est pas une décoration : il marque la sélection et l'ordre.
- **Typographie** : Archivo 800 (titres) · Archivo 400/600 (texte) · JetBrains Mono 600 (heures, codes).
- **Ton** (es, tutoiement) : « Total: US$ 181.90. Sin cargos al llegar. » · « Pago confirmado. Entrega las llaves. » · « Falta el contrato. Ábrelo y pide la firma. »
- **Style photo** : Lumière nette de studio ou de plein jour, fond blanc ou gris réel ; cadrages frontaux et de profil ; contraste franc, plaque floutée.
- **Mouvement** : Vif et mécanique : 150 à 220 ms, sans rebond ; les états changent par un fondu de couleur. Réduit à des fondus si l'utilisateur le demande.
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 10 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#0A0A0B` / `#FFFFFF` | **19.79** OK | `#F4F4F5` / `#0A0A0B` | **18.00** OK |
| texte / carte                                        | 4.5:1 | `#0A0A0B` / `#FFFFFF` | **19.79** OK | `#F4F4F5` / `#151517` | **16.59** OK |
| texte secondaire / surface                           | 4.5:1 | `#55565C` / `#FFFFFF` | **7.31** OK  | `#A8A9B0` / `#0A0A0B` | **8.45** OK  |
| texte secondaire / carte                             | 4.5:1 | `#55565C` / `#FFFFFF` | **7.31** OK  | `#A8A9B0` / `#151517` | **7.79** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#0A5CFF` | **5.27** OK  | `#0A0A0B` / `#5C8DFF` | **6.32** OK  |
| lien primaire / surface                              | 4.5:1 | `#0A5CFF` / `#FFFFFF` | **5.27** OK  | `#5C8DFF` / `#0A0A0B` | **6.32** OK  |
| lien primaire / carte                                | 4.5:1 | `#0A5CFF` / `#FFFFFF` | **5.27** OK  | `#5C8DFF` / `#151517` | **5.83** OK  |
| texte / accent                                       | 4.5:1 | `#FFFFFF` / `#0A0A0B` | **19.79** OK | `#0A0A0B` / `#F4F4F5` | **18.00** OK |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#151517` | **9.70** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#151517` | **8.03** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#151517` | **10.35** OK |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#0A0A0B` / `#FFFFFF` | **19.79** OK | `#8A8B93` / `#151517` | **5.38** OK  |
| anneau de focus / surface                            | 3.0:1 | `#0A0A0B` / `#FFFFFF` | **19.79** OK | `#5C8DFF` / `#0A0A0B` | **6.32** OK  |
| anneau de focus / carte                              | 3.0:1 | `#0A0A0B` / `#FFFFFF` | **19.79** OK | `#5C8DFF` / `#151517` | **5.83** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#0A5CFF` / `#FFFFFF` | **5.27** OK  | `#5C8DFF` / `#0A0A0B` | **6.32** OK  |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#0A5CFF` | **5.27** OK  | `#0A0A0B` / `#5C8DFF` | **6.32** OK  |
| logo : repère / pictogramme                          | 3.0:1 | `#0A0A0B` / `#0A5CFF` | **3.76** OK  | `#0A0A0B` / `#5C8DFF` | **6.32** OK  |
| logotype : K / surface                               | 3.0:1 | `#0A5CFF` / `#FFFFFF` | **5.27** OK  | `#5C8DFF` / `#0A0A0B` | **6.32** OK  |
| texte / fond en retrait                              | 4.5:1 | `#0A0A0B` / `#F2F3F5` | **17.82** OK | `#F4F4F5` / `#000000` | **19.11** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#55565C` / `#F2F3F5` | **6.59** OK  | `#A8A9B0` / `#000000` | **8.97** OK  |
| lien primaire / fond en retrait                      | 4.5:1 | `#0A5CFF` / `#F2F3F5` | **4.74** OK  | `#5C8DFF` / `#000000` | **6.71** OK  |
| texte / bandeau d'accueil                            | 4.5:1 | `#0A0A0B` / `#F2F3F5` | **17.82** OK | `#F4F4F5` / `#000000` | **19.11** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#0A5CFF` / `#F2F3F5` | **4.74** OK  | `#5C8DFF` / `#000000` | **6.71** OK  |
| surface / texte (onglet actif)                       | 4.5:1 | `#FFFFFF` / `#0A0A0B` | **19.79** OK | `#0A0A0B` / `#F4F4F5` | **18.00** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#0A5CFF` / `#F2F3F5` | **4.74** OK  | `#5C8DFF` / `#000000` | **6.71** OK  |

_Info : accent / surface = 19.79:1 (clair) et 18.00:1 (sombre) ; border décoratif / carte = 1.27:1 et 1.29:1 (jamais utilisé comme contour)._

### G — « Lagune » (frais, tropical, souriant)

- **Concept** : L'eau claire des lagons de Bocas del Toro et un corail tendre : une palette fraîche et souriante, très claire, qui parle aux voyageurs sans faire carte postale.
- **Logique de la palette** : Complémentaire : un bleu lagon (≈ 196°) et un corail doux (≈ 12°), opposés sur le cercle ; le corail reste un aplat clair de mise en avant, le bleu porte l'action.
- **Logo esquissé** : Un carré très arrondi bleu lagon porte un K blanc ; dessous, une vague corail. « Kmino » en Outfit 600, le K en bleu. SVG clair et sombre dans `tokens-lagune.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#F1FAFE` · 100 `#DEF4FC` · 200 `#B8E8F9` · 300 `#89D9F5` · 400 `#50C6F1` · 500 `#1DB5ED` · 600 `#1099CB` · 700 `#0A6F94` · 800 `#0A607F` · 900 `#07445A`.
- **Nuances corail** (50 → 900) : 50 `#FFF4F1` · 100 `#FFE2DA` · 200 `#FFB8A6` · 300 `#FF9C85` · 400 `#F47A5E` · 500 `#DB5A3D` · 600 `#B5432A` · 700 `#8C321F` · 800 `#5E2214` · 900 `#3A140C`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#0A6F94` | `#89D9F5` |
| on-primary     | `#FFFFFF` | `#06161C` |
| surface        | `#F5FBFC` | `#08171D` |
| surface-raised | `#FFFFFF` | `#10242C` |
| surface-sunken | `#E6F4F7` | `#041015` |
| text           | `#0E2228` | `#E9F6F8` |
| text-muted     | `#48626A` | `#A6C1C7` |
| border         | `#D2E6EA` | `#20383F` |
| border-strong  | `#6F8C93` | `#5E8088` |
| accent         | `#FFB8A6` | `#FF9C85` |
| on-accent      | `#3A140C` | `#2A0D07` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#0A6F94` | `#FF9C85` |

- **Règle d'accent** : Le corail (#FFB8A6) sert d'aplat sous texte foncé pour les badges (« Nuevo », « ITBMS incluido ») ; il n'est jamais seul indicateur (1,59:1 avec la surface).
- **Typographie** : Outfit 600 (titres) · Source Sans 3 400/700 (texte, chiffres tabulaires).
- **Ton** (es, tutoiement) : « Elige el auto de un vecino y sal a la ruta. » · « Cancelación gratuita hasta el jue. 13 ene., 10:00. » · « ¡Listo! Tu reserva está confirmada. »
- **Style photo** : Lumière tropicale du matin, eau et végétation en arrière-plan ; la voiture en situation (route côtière, Asunción en fin de journée) ; saturation naturelle.
- **Mouvement** : Vivant mais bref : 160 à 280 ms ; un léger rebond réservé aux confirmations. Réduit à des fondus si l'utilisateur le demande.
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 10 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#0E2228` / `#F5FBFC` | **15.72** OK | `#E9F6F8` / `#08171D` | **16.51** OK |
| texte / carte                                        | 4.5:1 | `#0E2228` / `#FFFFFF` | **16.43** OK | `#E9F6F8` / `#10242C` | **14.50** OK |
| texte secondaire / surface                           | 4.5:1 | `#48626A` / `#F5FBFC` | **6.22** OK  | `#A6C1C7` / `#08171D` | **9.62** OK  |
| texte secondaire / carte                             | 4.5:1 | `#48626A` / `#FFFFFF` | **6.50** OK  | `#A6C1C7` / `#10242C` | **8.45** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#0A6F94` | **5.65** OK  | `#06161C` / `#89D9F5` | **11.68** OK |
| lien primaire / surface                              | 4.5:1 | `#0A6F94` / `#F5FBFC` | **5.41** OK  | `#89D9F5` / `#08171D` | **11.57** OK |
| lien primaire / carte                                | 4.5:1 | `#0A6F94` / `#FFFFFF` | **5.65** OK  | `#89D9F5` / `#10242C` | **10.15** OK |
| texte / accent                                       | 4.5:1 | `#3A140C` / `#FFB8A6` | **9.85** OK  | `#2A0D07` / `#FF9C85` | **8.93** OK  |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#10242C` | **8.52** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#10242C` | **7.05** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#10242C` | **9.09** OK  |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#6F8C93` / `#FFFFFF` | **3.59** OK  | `#5E8088` / `#10242C` | **3.75** OK  |
| anneau de focus / surface                            | 3.0:1 | `#0A6F94` / `#F5FBFC` | **5.41** OK  | `#FF9C85` / `#08171D` | **8.99** OK  |
| anneau de focus / carte                              | 3.0:1 | `#0A6F94` / `#FFFFFF` | **5.65** OK  | `#FF9C85` / `#10242C` | **7.89** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#0A6F94` / `#F5FBFC` | **5.41** OK  | `#89D9F5` / `#08171D` | **11.57** OK |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#0A6F94` | **5.65** OK  | `#06161C` / `#89D9F5` | **11.68** OK |
| logo : repère / pictogramme                          | 3.0:1 | `#FFB8A6` / `#0A6F94` | **3.41** OK  | `#06161C` / `#89D9F5` | **11.68** OK |
| logotype : K / surface                               | 3.0:1 | `#0A6F94` / `#F5FBFC` | **5.41** OK  | `#89D9F5` / `#08171D` | **11.57** OK |
| texte / fond en retrait                              | 4.5:1 | `#0E2228` / `#E6F4F7` | **14.59** OK | `#E9F6F8` / `#041015` | **17.43** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#48626A` / `#E6F4F7` | **5.77** OK  | `#A6C1C7` / `#041015` | **10.16** OK |
| lien primaire / fond en retrait                      | 4.5:1 | `#0A6F94` / `#E6F4F7` | **5.02** OK  | `#89D9F5` / `#041015` | **12.21** OK |
| texte / bandeau d'accueil                            | 4.5:1 | `#0E2228` / `#E6F4F7` | **14.59** OK | `#E9F6F8` / `#041015` | **17.43** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#0A6F94` / `#E6F4F7` | **5.02** OK  | `#89D9F5` / `#041015` | **12.21** OK |
| surface / texte (onglet actif)                       | 4.5:1 | `#F5FBFC` / `#0E2228` | **15.72** OK | `#08171D` / `#E9F6F8` | **16.51** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#0A6F94` / `#E6F4F7` | **5.02** OK  | `#89D9F5` / `#041015` | **12.21** OK |

_Info : accent / surface = 1.59:1 (clair) et 8.99:1 (sombre) ; border décoratif / carte = 1.29:1 et 1.30:1 (jamais utilisé comme contour)._

### Contrôle des palettes claires

- **Contrastes** : 4 × (18 paires + 10 contrôles complémentaires) × 2 thèmes = **224 paires, toutes conformes** (4,5:1 pour le texte ; 3:1 pour contours, focus et logo). Les contrôles complémentaires couvrent le logo (K et repère sur le pictogramme, K du logotype sur la surface), les fonds en retrait, le bandeau d'accueil et l'onglet actif.
- **Teintes** : bleus principaux entre 196° et 222° (clair et sombre) ; aucun jeton saturé dans la zone 230° à 300° (les gris quasi neutres de Voltio y ont une teinte nominale, à 4 ou 5 % de saturation ; revue code du 2026-11-03, remarque 7).
- **Anti-Turo** : Cielo : Bleu ciel #096CAA (≈ 203°) : ni violet ni indigo. Disque et courbe d'horizon. Recherche dans une carte posée sur un bandeau clair, sans photo plein écran. Marina : Marine #1A3F70 (≈ 214°) et sable (≈ 40°) : ni violet ni indigo. Carré à trait fin et mot-symbole serif. Titre éditorial, sans photo plein écran ni barre en pilule. Voltio : Bleu électrique #0A5CFF (≈ 220°), en dehors de la zone 230°–300° exclue. Carré à angles vifs. Étapes numérotées, sans photo plein écran ni barre en pilule. Lagune : Bleu lagon #0A6F94 (≈ 196°) et corail (≈ 12°) : ni violet ni indigo. Carré arrondi et vague. Carte de recherche sur fond d'eau claire, sans photo plein écran. Aucune note en étoiles ni badge d'hôte ; prix final et caution avant les avis.
- **Proximités à vérifier** : Marina est dans la famille du marine de grands sites de voyage (Booking, par exemple) et Voltio près de leur bleu d'action ; Lagune s'éloigne du vert de Localiza, Europcar et Enterprise. À regarder côte à côte avant de choisir, sans rien copier.
- **Cibles tactiles** : la page `presentation.html` passe à 48 px au moins pour ses onglets, ses boutons de thème, ses puces de lieu, ses liens « ver condiciones » et ses résumés dépliables (remarque 3 de la revue UX du 2026-11-02) ; mesure à 360 px : aucun élément interactif sous 48 × 48 px.

## Blanc épuré (2026-11-02) : famille « Lienzo », trois variantes

**Retour du fondateur (2026-11-02)** : « pourquoi t'en as fait aucun sur fond blanc épuré ? », puis « je veux plusieurs variations de blanc épuré ». C'est exact : Cielo, Marina et Lagune ont un fond teinté, et Voltio a un fond blanc, mais saturé (bleu électrique, aplats noirs). La famille **Lienzo** (« toile » en espagnol : la toile blanche avant la première touche de couleur) répond à cette demande avec trois variantes.

**Base commune aux trois** : fond **blanc pur `#FFFFFF`** partout (page, cartes, barre d'action) ; gris neutres très pâles seulement pour séparer (`#F6F7F8` en retrait, filets `#E6E7E9` de 1 px) ; texte **noir doux `#17181B`** (pas `#000`) et texte secondaire `#575A60` ; contours de champs `#8A8D93` (3,33:1) ; ombres quasi nulles ; beaucoup d'espace ; une seule couleur, rare, réservée à l'action (bouton Reservar, liens, élément sélectionné). L'onglet actif est un **soulignement** de 2 px dans la couleur d'action, pas un aplat. Les états (succès, danger, attention) gardent les couleurs communes à toutes les directions. Thème sombre fourni (fond `#111214`, cartes `#191A1D`, texte `#EDEEF0`).

**Nom** : « Lienzo » est un mot courant de l'espagnol ; nous ne connaissons pas de marque notoire de ce nom dans la location, le voyage ou la mobilité. Ce n'est qu'un nom de travail de la palette (la marque reste Kmino) ; aucune recherche en base de marques n'a été faite, et il n'y en a pas besoin tant qu'il ne sort pas de ce dossier.

| Variante             | Couleur d'action (clair / sombre) | Liens, onglet actif, focus | Logique de la palette                                                                                                                                                                                                                        | Police                            |
| -------------------- | --------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **Lienzo · Tinta**   | `#1D3461` / `#A9C1EA`             | `#1D3461` / `#A9C1EA`      | Blanc + gris neutres + une encre bleu nuit (≈ 220°, désaturée) : la couleur n'apparaît que là où l'on agit ; les zones sont séparées par des filets gris de 1 px et de l'espace, pas par des aplats.                                         | Bricolage Grotesque 600 + Manrope |
| **Lienzo · Azur**    | `#1E6AC2` / `#7DB4F5`             | `#1E6AC2` / `#7DB4F5`      | Blanc + gris neutres + un bleu azur moyen (≈ 213°, saturation modérée) : un seul bleu pour l'action, ses nuances pâles pour les pastilles ; aucun fond teinté, aucun noir en aplat.                                                          | Bricolage Grotesque 700 + Manrope |
| **Lienzo · Grafito** | `#2A2C30` / `#E8E9EB`             | `#2563C9` / `#7FAEF5`      | Monochrome : blanc, gris et graphite (#2A2C30) pour le bouton ; un seul bleu (≈ 217°) réduit à des traits (liens, soulignement de l'onglet actif, anneau de focus, point du logo). La hiérarchie vient de la typographie, pas de la couleur. | Instrument Serif + Manrope        |

**Pourquoi elles diffèrent de Cielo et de Voltio** : Cielo teinte tout en bleu ciel (fond `#F7FBFE`, gris bleutés, bandeau bleu `#DDF1FD` sous le titre) ; Lienzo n'a **aucun fond teinté** et des gris neutres, et le bleu n'apparaît que sur ce qui se touche. Voltio crie (bleu électrique `#0A5CFF` à 100 % de saturation, bordures et onglet noirs en aplat, chiffres monospace) ; Lienzo chuchote (bleus désaturés, filets gris de 1 px, aucun aplat noir). **Entre elles** : Tinta est la plus élégante (encre bleu nuit, presque noire, 12,24:1) ; Azur est la plus fraîche et la plus proche de l'esprit Cielo, mais sur blanc pur ; Grafito est presque monochrome (bouton graphite) et tient sa voix par des titres en serif, avec un bleu réduit à des traits. Tinta reste proche du marine de **Marina** par la teinte (220° contre 214°), mais sans sable ni serif et sur blanc pur.

### H1 — « Lienzo · Tinta » (élégant, sûr)

- **Concept** : La page blanche et l'encre : un fond blanc pur, du texte noir doux et une seule encre bleu nuit, rare, posée sur le bouton Reservar, les liens et la sélection. Le calme d'un document bien composé.
- **Logique de la palette** : Blanc + gris neutres + une encre bleu nuit (≈ 220°, désaturée) : la couleur n'apparaît que là où l'on agit ; les zones sont séparées par des filets gris de 1 px et de l'espace, pas par des aplats.
- **Logo esquissé** : Un carré aux angles doux porte un K au trait fin ; un point dans l'angle marque le repère (le point sur la carte). Ici le carré est à l'encre bleu nuit, K et point blancs. « Kmino » en Bricolage Grotesque 600, le K à l'encre. SVG clair et sombre dans `tokens-lienzo-tinta.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#EEF2F9` · 100 `#E5EAF5` · 200 `#C8D3EA` · 300 `#A9C1EA` · 400 `#7692CB` · 500 `#4E72BC` · 600 `#3C5D9F` · 700 `#314C81` · 800 `#1D3461` · 900 `#1B2946`.
- **Nuances neutres** (50 → 900, communes à la famille) : 50 `#F6F7F8` · 100 `#F1F2F3` · 200 `#E6E7E9` · 300 `#D0D2D5` · 400 `#8A8D93` · 500 `#6E7177` · 600 `#575A60` · 700 `#3E4146` · 800 `#2A2C30` · 900 `#17181B`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#1D3461` | `#A9C1EA` |
| on-primary     | `#FFFFFF` | `#111214` |
| surface        | `#FFFFFF` | `#111214` |
| surface-raised | `#FFFFFF` | `#191A1D` |
| surface-sunken | `#F6F7F8` | `#0B0C0D` |
| text           | `#17181B` | `#EDEEF0` |
| text-muted     | `#575A60` | `#A4A7AD` |
| border         | `#E6E7E9` | `#2A2C30` |
| border-strong  | `#8A8D93` | `#767A80` |
| accent         | `#EEF2F9` | `#1A2438` |
| on-accent      | `#1D3461` | `#DCE6F7` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#1D3461` | `#A9C1EA` |

- **Règle d'accent** : L'accent est le bleu 50 (#EEF2F9) : un voile à peine visible sous texte encre, réservé aux pastilles et au surlignage ; jamais un aplat de section ni un indicateur seul.
- **Typographie** : Bricolage Grotesque 600 (titres d'affichage, serrés) · Manrope 400/600 (texte, chiffres tabulaires).
- **Ton** (es, tutoiement) : « Precio final, con ITBMS incluido. » · « Reserva confirmada. Te esperamos el vie. 14 ene., 10:00. » · « Ana aceptó tu solicitud. Ya puedes escribirle. »
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 13 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#17181B` / `#FFFFFF` | **17.75** OK | `#EDEEF0` / `#111214` | **16.14** OK |
| texte / carte                                        | 4.5:1 | `#17181B` / `#FFFFFF` | **17.75** OK | `#EDEEF0` / `#191A1D` | **14.99** OK |
| texte secondaire / surface                           | 4.5:1 | `#575A60` / `#FFFFFF` | **6.92** OK  | `#A4A7AD` / `#111214` | **7.77** OK  |
| texte secondaire / carte                             | 4.5:1 | `#575A60` / `#FFFFFF` | **6.92** OK  | `#A4A7AD` / `#191A1D` | **7.22** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#1D3461` | **12.24** OK | `#111214` / `#A9C1EA` | **10.27** OK |
| lien primaire / surface                              | 4.5:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#111214` | **10.27** OK |
| lien primaire / carte                                | 4.5:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#191A1D` | **9.53** OK  |
| texte / accent                                       | 4.5:1 | `#1D3461` / `#EEF2F9` | **10.90** OK | `#DCE6F7` / `#1A2438` | **12.34** OK |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#191A1D` | **9.26** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#191A1D` | **7.66** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#191A1D` | **9.88** OK  |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#8A8D93` / `#FFFFFF` | **3.33** OK  | `#767A80` / `#191A1D` | **4.03** OK  |
| anneau de focus / surface                            | 3.0:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#111214` | **10.27** OK |
| anneau de focus / carte                              | 3.0:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#191A1D` | **9.53** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#111214` | **10.27** OK |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#1D3461` | **12.24** OK | `#111214` / `#A9C1EA` | **10.27** OK |
| logo : repère / pictogramme                          | 3.0:1 | `#FFFFFF` / `#1D3461` | **12.24** OK | `#111214` / `#A9C1EA` | **10.27** OK |
| logotype : K / surface                               | 3.0:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#111214` | **10.27** OK |
| texte / fond en retrait                              | 4.5:1 | `#17181B` / `#F6F7F8` | **16.55** OK | `#EDEEF0` / `#0B0C0D` | **16.86** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#575A60` / `#F6F7F8` | **6.45** OK  | `#A4A7AD` / `#0B0C0D` | **8.12** OK  |
| lien primaire / fond en retrait                      | 4.5:1 | `#1D3461` / `#F6F7F8` | **11.41** OK | `#A9C1EA` / `#0B0C0D` | **10.72** OK |
| texte / bandeau d'accueil                            | 4.5:1 | `#17181B` / `#F6F7F8` | **16.55** OK | `#EDEEF0` / `#0B0C0D` | **16.86** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#1D3461` / `#F6F7F8` | **11.41** OK | `#A9C1EA` / `#0B0C0D` | **10.72** OK |
| surface / texte (onglet actif)                       | 4.5:1 | `#FFFFFF` / `#17181B` | **17.75** OK | `#111214` / `#EDEEF0` | **16.14** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#1D3461` / `#F6F7F8` | **11.41** OK | `#A9C1EA` / `#0B0C0D` | **10.72** OK |
| lien et onglet actif (focus) / carte                 | 4.5:1 | `#1D3461` / `#FFFFFF` | **12.24** OK | `#A9C1EA` / `#191A1D` | **9.53** OK  |
| lien et onglet actif (focus) / fond en retrait       | 4.5:1 | `#1D3461` / `#F6F7F8` | **11.41** OK | `#A9C1EA` / `#0B0C0D` | **10.72** OK |
| logo : point / pictogramme (rappel)                  | 3.0:1 | `#FFFFFF` / `#1D3461` | **12.24** OK | `#111214` / `#A9C1EA` | **10.27** OK |

### H2 — « Lienzo · Azur » (frais, ouvert)

- **Concept** : Le même blanc pur, avec un bleu azur vif mais doux : l'air d'un matin clair. Plus accueillant que Tinta, plus calme que Voltio ; le bleu reste rare et signale ce qui se touche.
- **Logique de la palette** : Blanc + gris neutres + un bleu azur moyen (≈ 213°, saturation modérée) : un seul bleu pour l'action, ses nuances pâles pour les pastilles ; aucun fond teinté, aucun noir en aplat.
- **Logo esquissé** : Un carré aux angles doux porte un K au trait fin ; un point dans l'angle marque le repère (le point sur la carte). Ici le carré est azur, K et point blancs. « Kmino » en Bricolage Grotesque 700, le K en azur. SVG clair et sombre dans `tokens-lienzo-azur.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#EAF2FC` · 100 `#E0ECFA` · 200 `#BDD6F4` · 300 `#7DB4F5` · 400 `#5D9AE5` · 500 `#2C7CDD` · 600 `#1F66BD` · 700 `#1E6AC2` · 800 `#134076` · 900 `#0E2D53`.
- **Nuances neutres** (50 → 900, communes à la famille) : 50 `#F6F7F8` · 100 `#F1F2F3` · 200 `#E6E7E9` · 300 `#D0D2D5` · 400 `#8A8D93` · 500 `#6E7177` · 600 `#575A60` · 700 `#3E4146` · 800 `#2A2C30` · 900 `#17181B`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#1E6AC2` | `#7DB4F5` |
| on-primary     | `#FFFFFF` | `#0B0C0D` |
| surface        | `#FFFFFF` | `#111214` |
| surface-raised | `#FFFFFF` | `#191A1D` |
| surface-sunken | `#F6F7F8` | `#0B0C0D` |
| text           | `#17181B` | `#EDEEF0` |
| text-muted     | `#575A60` | `#A4A7AD` |
| border         | `#E6E7E9` | `#2A2C30` |
| border-strong  | `#8A8D93` | `#767A80` |
| accent         | `#EAF2FC` | `#10294A` |
| on-accent      | `#0F3F7A` | `#D6E8FD` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#1E6AC2` | `#7DB4F5` |

- **Règle d'accent** : L'accent est le bleu 50 (#EAF2FC) : un voile azur très pâle sous texte bleu profond, réservé aux pastilles et au surlignage ; jamais un aplat de section ni un indicateur seul.
- **Typographie** : Bricolage Grotesque 700 (titres d'affichage, serrés) · Manrope 400/600 (texte, chiffres tabulaires).
- **Ton** (es, tutoiement) : « Tu precio final ya incluye ITBMS. » · « ¡Listo! Tu auto te espera el vie. 14 ene. a las 10:00. » · « No pudimos cargar los autos cercanos. Vuelve a intentarlo. »
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 13 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#17181B` / `#FFFFFF` | **17.75** OK | `#EDEEF0` / `#111214` | **16.14** OK |
| texte / carte                                        | 4.5:1 | `#17181B` / `#FFFFFF` | **17.75** OK | `#EDEEF0` / `#191A1D` | **14.99** OK |
| texte secondaire / surface                           | 4.5:1 | `#575A60` / `#FFFFFF` | **6.92** OK  | `#A4A7AD` / `#111214` | **7.77** OK  |
| texte secondaire / carte                             | 4.5:1 | `#575A60` / `#FFFFFF` | **6.92** OK  | `#A4A7AD` / `#191A1D` | **7.22** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#1E6AC2` | **5.39** OK  | `#0B0C0D` / `#7DB4F5` | **9.06** OK  |
| lien primaire / surface                              | 4.5:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#111214` | **8.67** OK  |
| lien primaire / carte                                | 4.5:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#191A1D` | **8.05** OK  |
| texte / accent                                       | 4.5:1 | `#0F3F7A` / `#EAF2FC` | **9.25** OK  | `#D6E8FD` / `#10294A` | **11.70** OK |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#191A1D` | **9.26** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#191A1D` | **7.66** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#191A1D` | **9.88** OK  |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#8A8D93` / `#FFFFFF` | **3.33** OK  | `#767A80` / `#191A1D` | **4.03** OK  |
| anneau de focus / surface                            | 3.0:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#111214` | **8.67** OK  |
| anneau de focus / carte                              | 3.0:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#191A1D` | **8.05** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#111214` | **8.67** OK  |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#1E6AC2` | **5.39** OK  | `#0B0C0D` / `#7DB4F5` | **9.06** OK  |
| logo : repère / pictogramme                          | 3.0:1 | `#FFFFFF` / `#1E6AC2` | **5.39** OK  | `#0B0C0D` / `#7DB4F5` | **9.06** OK  |
| logotype : K / surface                               | 3.0:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#111214` | **8.67** OK  |
| texte / fond en retrait                              | 4.5:1 | `#17181B` / `#F6F7F8` | **16.55** OK | `#EDEEF0` / `#0B0C0D` | **16.86** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#575A60` / `#F6F7F8` | **6.45** OK  | `#A4A7AD` / `#0B0C0D` | **8.12** OK  |
| lien primaire / fond en retrait                      | 4.5:1 | `#1E6AC2` / `#F6F7F8` | **5.03** OK  | `#7DB4F5` / `#0B0C0D` | **9.06** OK  |
| texte / bandeau d'accueil                            | 4.5:1 | `#17181B` / `#F6F7F8` | **16.55** OK | `#EDEEF0` / `#0B0C0D` | **16.86** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#1E6AC2` / `#F6F7F8` | **5.03** OK  | `#7DB4F5` / `#0B0C0D` | **9.06** OK  |
| surface / texte (onglet actif)                       | 4.5:1 | `#FFFFFF` / `#17181B` | **17.75** OK | `#111214` / `#EDEEF0` | **16.14** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#1E6AC2` / `#F6F7F8` | **5.03** OK  | `#7DB4F5` / `#0B0C0D` | **9.06** OK  |
| lien et onglet actif (focus) / carte                 | 4.5:1 | `#1E6AC2` / `#FFFFFF` | **5.39** OK  | `#7DB4F5` / `#191A1D` | **8.05** OK  |
| lien et onglet actif (focus) / fond en retrait       | 4.5:1 | `#1E6AC2` / `#F6F7F8` | **5.03** OK  | `#7DB4F5` / `#0B0C0D` | **9.06** OK  |
| logo : point / pictogramme (rappel)                  | 3.0:1 | `#FFFFFF` / `#1E6AC2` | **5.39** OK  | `#0B0C0D` / `#7DB4F5` | **9.06** OK  |

### H3 — « Lienzo · Grafito » (éditorial, minimal)

- **Concept** : Le blanc et le crayon graphite : presque monochrome, comme une belle mise en page de revue. Les titres en serif donnent la voix ; un bleu minuscule n'apparaît que sur les liens, l'onglet actif et le focus.
- **Logique de la palette** : Monochrome : blanc, gris et graphite (#2A2C30) pour le bouton ; un seul bleu (≈ 217°) réduit à des traits (liens, soulignement de l'onglet actif, anneau de focus, point du logo). La hiérarchie vient de la typographie, pas de la couleur.
- **Logo esquissé** : Un carré aux angles doux porte un K au trait fin ; un point dans l'angle marque le repère (le point sur la carte). Ici le carré est graphite, K blanc et point bleu (le seul bleu du logo). « Kmino » en Instrument Serif, le K en graphite. SVG clair et sombre dans `tokens-lienzo-grafito.json → brand.logo` et `brand.logoDark`.
- **Nuances du bleu** (50 → 900) : 50 `#F2F6FD` · 100 `#E1EAFA` · 200 `#BED3F4` · 300 `#7FAEF5` · 400 `#4A86E8` · 500 `#2F71DA` · 600 `#2563C9` · 700 `#1B4B98` · 800 `#153A75` · 900 `#0F2952`.
- **Nuances neutres** (50 → 900, communes à la famille) : 50 `#F6F7F8` · 100 `#F1F2F3` · 200 `#E6E7E9` · 300 `#D0D2D5` · 400 `#8A8D93` · 500 `#6E7177` · 600 `#575A60` · 700 `#3E4146` · 800 `#2A2C30` · 900 `#17181B`.
- **Palette fonctionnelle** :

| Jeton          | Clair     | Sombre    |
| -------------- | --------- | --------- |
| primary        | `#2A2C30` | `#E8E9EB` |
| on-primary     | `#FFFFFF` | `#111214` |
| surface        | `#FFFFFF` | `#111214` |
| surface-raised | `#FFFFFF` | `#191A1D` |
| surface-sunken | `#F6F7F8` | `#0B0C0D` |
| text           | `#17181B` | `#EDEEF0` |
| text-muted     | `#575A60` | `#A4A7AD` |
| border         | `#E6E7E9` | `#2A2C30` |
| border-strong  | `#8A8D93` | `#767A80` |
| accent         | `#F1F2F3` | `#232428` |
| on-accent      | `#17181B` | `#EDEEF0` |
| success        | `#1B6B39` | `#5FD38A` |
| success-soft   | `#E3F4E9` | `#10271A` |
| danger         | `#B42318` | `#FF8B7E` |
| danger-soft    | `#FDE8E6` | `#33171A` |
| warning        | `#855300` | `#F5B94A` |
| warning-soft   | `#FCEFD6` | `#2E2410` |
| focus          | `#2563C9` | `#7FAEF5` |

- **Règle d'accent** : L'accent est le gris 100 (#F1F2F3) : un fond à peine marqué sous texte noir doux pour les pastilles. Le bleu n'est pas l'accent : il est porté par le jeton focus (liens, onglet actif, focus), en traits seulement.
- **Typographie** : Instrument Serif 400 (titres d'affichage seulement) · Manrope 400/600 (texte, chiffres tabulaires).
- **Ton** (es, tutoiement) : « El precio que ves es el que pagas. » · « Tu reserva está confirmada. » · « Falta firmar el contrato. Ábrelo y pide la firma al cliente. »
- **Contrastes WCAG 2.2 AA** (calculés par script ; détail des 18 paires et des 13 contrôles complémentaires dans `contrastChecks`) :

| Paire                                                | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ---------------------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                                      | 4.5:1 | `#17181B` / `#FFFFFF` | **17.75** OK | `#EDEEF0` / `#111214` | **16.14** OK |
| texte / carte                                        | 4.5:1 | `#17181B` / `#FFFFFF` | **17.75** OK | `#EDEEF0` / `#191A1D` | **14.99** OK |
| texte secondaire / surface                           | 4.5:1 | `#575A60` / `#FFFFFF` | **6.92** OK  | `#A4A7AD` / `#111214` | **7.77** OK  |
| texte secondaire / carte                             | 4.5:1 | `#575A60` / `#FFFFFF` | **6.92** OK  | `#A4A7AD` / `#191A1D` | **7.22** OK  |
| texte du bouton / primaire                           | 4.5:1 | `#FFFFFF` / `#2A2C30` | **13.99** OK | `#111214` / `#E8E9EB` | **15.43** OK |
| lien primaire / surface                              | 4.5:1 | `#2A2C30` / `#FFFFFF` | **13.99** OK | `#E8E9EB` / `#111214` | **15.43** OK |
| lien primaire / carte                                | 4.5:1 | `#2A2C30` / `#FFFFFF` | **13.99** OK | `#E8E9EB` / `#191A1D` | **14.32** OK |
| texte / accent                                       | 4.5:1 | `#17181B` / `#F1F2F3` | **15.84** OK | `#EDEEF0` / `#232428` | **13.36** OK |
| succès (texte) / carte                               | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#191A1D` | **9.26** OK  |
| danger (texte) / carte                               | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#191A1D` | **7.66** OK  |
| attention (texte) / carte                            | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#191A1D` | **9.88** OK  |
| succès / fond succès                                 | 4.5:1 | `#1B6B39` / `#E3F4E9` | **5.73** OK  | `#5FD38A` / `#10271A` | **8.42** OK  |
| danger / fond danger                                 | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention                           | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte                             | 3.0:1 | `#8A8D93` / `#FFFFFF` | **3.33** OK  | `#767A80` / `#191A1D` | **4.03** OK  |
| anneau de focus / surface                            | 3.0:1 | `#2563C9` / `#FFFFFF` | **5.67** OK  | `#7FAEF5` / `#111214` | **8.28** OK  |
| anneau de focus / carte                              | 3.0:1 | `#2563C9` / `#FFFFFF` | **5.67** OK  | `#7FAEF5` / `#191A1D` | **7.69** OK  |
| composant primaire / surface (1.4.11)                | 3.0:1 | `#2A2C30` / `#FFFFFF` | **13.99** OK | `#E8E9EB` / `#111214` | **15.43** OK |
| logo : K / pictogramme                               | 3.0:1 | `#FFFFFF` / `#2A2C30` | **13.99** OK | `#111214` / `#E8E9EB` | **15.43** OK |
| logo : repère / pictogramme                          | 3.0:1 | `#4A86E8` / `#2A2C30` | **3.91** OK  | `#2563C9` / `#E8E9EB` | **4.66** OK  |
| logotype : K / surface                               | 3.0:1 | `#2A2C30` / `#FFFFFF` | **13.99** OK | `#E8E9EB` / `#111214` | **15.43** OK |
| texte / fond en retrait                              | 4.5:1 | `#17181B` / `#F6F7F8` | **16.55** OK | `#EDEEF0` / `#0B0C0D` | **16.86** OK |
| texte secondaire / fond en retrait                   | 4.5:1 | `#575A60` / `#F6F7F8` | **6.45** OK  | `#A4A7AD` / `#0B0C0D` | **8.12** OK  |
| lien primaire / fond en retrait                      | 4.5:1 | `#2A2C30` / `#F6F7F8` | **13.04** OK | `#E8E9EB` / `#0B0C0D` | **16.12** OK |
| texte / bandeau d'accueil                            | 4.5:1 | `#17181B` / `#F6F7F8` | **16.55** OK | `#EDEEF0` / `#0B0C0D` | **16.86** OK |
| lien primaire / bandeau d'accueil                    | 4.5:1 | `#2A2C30` / `#F6F7F8` | **13.04** OK | `#E8E9EB` / `#0B0C0D` | **16.12** OK |
| surface / texte (onglet actif)                       | 4.5:1 | `#FFFFFF` / `#17181B` | **17.75** OK | `#111214` / `#EDEEF0` | **16.14** OK |
| texte du bouton / primaire sur fond en retrait (3:1) | 3.0:1 | `#2A2C30` / `#F6F7F8` | **13.04** OK | `#E8E9EB` / `#0B0C0D` | **16.12** OK |
| lien et onglet actif (focus) / carte                 | 4.5:1 | `#2563C9` / `#FFFFFF` | **5.67** OK  | `#7FAEF5` / `#191A1D` | **7.69** OK  |
| lien et onglet actif (focus) / fond en retrait       | 4.5:1 | `#2563C9` / `#F6F7F8` | **5.28** OK  | `#7FAEF5` / `#0B0C0D` | **8.65** OK  |
| logo : point / pictogramme (rappel)                  | 3.0:1 | `#4A86E8` / `#2A2C30` | **3.91** OK  | `#2563C9` / `#E8E9EB` | **4.66** OK  |

### Contrôle de la famille Lienzo

- **Contrastes** : 3 × (18 paires + 13 contrôles complémentaires) × 2 thèmes = **186 paires, toutes conformes**. Les trois contrôles ajoutés à la famille portent sur la couleur des liens et de l'onglet actif (`focus`, ≥ 4,5:1 sur carte et sur fond en retrait, car elle sert de texte de lien) et sur le point du logo. Pires cas : contour de champ `#8A8D93` sur blanc **3,33:1** (seuil 3) ; point bleu du logo Grafito **3,91:1** (clair) et **4,66:1** (sombre) ; lien Azur sur fond en retrait **5,03:1**.
- **Rendu réel** : voir « Positionnement entre particuliers », garde-fou « Contrôles » (375 et 360 px, es et en, clair et sombre : 0 débordement, 0 cible sous 48 px, 0 échec de contraste).
- **Teintes** : couleurs d'action entre 212° et 220°, liens Grafito à 217° ; aucun jeton saturé dans la zone 230° à 300° (les gris neutres ont une teinte nominale de 220° à 225° pour 4 à 8 % de saturation).
- **Anti-Turo** : Encre bleu nuit #1D3461 (≈ 220°), hors de la zone 230°–300°. Carré doux et point. Page blanche, filets fins, sans photo plein écran ni bandeau coloré. Azur #1E6AC2 (≈ 213°, saturation 73 %), ni l'électrique de Voltio ni le bleu ciel de Cielo. Carré doux et point. Page blanche, sans photo plein écran. Graphite #2A2C30 et un bleu #2563C9 (≈ 217°) en traits, hors de la zone 230°–300°. Titres en serif libre (Instrument Serif). Page blanche, sans photo plein écran ni aplat noir. Aucun badge de statut d'hôte (voir « Positionnement entre particuliers » pour l'étoile de la note).

---

## Langage visuel (2026-11-02, base pour US-030)

**Intention** : « waouh », mais propre et épuré. Une page blanche, une auto dessinée comme un produit, un grand titre, et un seul fil conducteur graphique : le _camino_.

### Principes

- **La typographie est le héros.** Titres d'affichage grands et serrés : Bricolage Grotesque (Azur 700, Tinta 600) ou Instrument Serif (Grafito), 44 px environ sur l'accueil (38 px sous 400 px de large), interlettrage de -0,045 à -0,02 em, interligne 0,96 à 1. Le texte reste en Manrope 16 à 17 px. Contraste d'échelle franc : environ 2,6 entre le titre et le texte ; peu de tailles (44 / 30 / 21 / 17 / 14 / 12,5).
- **Grille de 8 px**, rythmes verticaux généreux : 32 px entre sections, 16 à 24 px dans les cartes, marges de 16 px.
- **Blanc d'abord, couleur rare.** La couleur d'action ne sert qu'aux boutons, liens, numéros d'étape et au tracé ; les fonds sont blancs ou gris très pâles ; le sombre reprend la même hiérarchie (fond #111214, cartes #191A1D).
- **Profondeur douce.** Cartes à 20 px de rayon, filet de 1 px, ombre double très diffuse (0 1 2 à 4 % et 0 10 28 à 10 %, 50 % en sombre). Verre dépoli seulement là où il se voit : barre de recherche collante (le contenu défile dessous), boutons sur la galerie, barre d'action, et dans Tinta la carte de l'hôte et la recherche posées sur le bloc « nuit » (fond blanc à 10 %, flou 16 px). Ailleurs, cartes pleines.
- **Visuels maison.** Autos dessinées par nous en SVG, en **vue de trois-quarts** et en **aplats sobres** : flanc dans la teinte de la peinture, dessus éclairé, face avant un ton plus sombre, vitrages ardoise, un seul reflet doux sur l'épaule, roues pleines à jante lisse, ombre portée floue au sol. **Quatre silhouettes** fidèles aux modèles cités : citadine à hayon (Kia Picanto, Suzuki Swift), berline (Toyota Yaris Sedán, Toyota Corolla), SUV compact (Hyundai Tucson), pick-up (Toyota Hilux). Peintures sourdes accordées au blanc épuré (bleu ardoise, argent, graphite, nacre, sable) ; dans Grafito, toutes sont ramenées vers le graphite. Hôtes en monogrammes sur quatre tons doux, déclinés en sombre. Aucune photo de personne, aucune image téléchargée.
- **États soignés.** Survol : la carte monte de 2 px et son ombre s'élargit ; appui : échelle 0,98 ; focus : anneau de 2 px dans la couleur `focus`, décalé de 2 px ; contrôles personnalisés (radios, interrupteur) dont la cible couvre toute la ligne (48 px au moins).

### Trois personnalités, une même épure

- **Azur, lumineuse et aérée** : halo azur très pâle derrière l'auto, carte de l'hôte posée dessous, recherche flottante qui devient collante.
- **Tinta, « nuit chic »** : l'accueil s'ouvre sur un bloc encre profonde (dégradé #2A4A7C → #0E1830) aux coins arrondis, titre blanc ; c'est là que le verre dépoli se voit vraiment (carte de l'hôte et recherche translucides sur la nuit). Le reste de la page redevient blanc.
- **Grafito, éditoriale** : titre en Instrument Serif, filet court, l'auto présentée comme une planche de magazine (cadre fin, légende en italique « _Kia Picanto 2021_ — de María, en San Francisco »), sections numérotées « 01 », « 02 », citation en grand italique entre deux filets.

**Chaleur humaine** : des mots d'hôtes et de voyageurs fictifs, au tutoiement. Sur l'accueil, María : « Mi Picanto pasaba la semana estacionado. Ahora ayuda a alguien que llega a la ciudad, y a mí me ayuda con la cuota. » ; sur la fiche, sa promesse (« Te lo entrego limpio y con el tanque lleno… ») et l'avis de Diego. Les mêmes textes existent en anglais.

**Recherche flottante et galerie bord à bord** : la barre de recherche flotte au-dessus du contenu pour rester à portée du pouce au défilement ; sur la fiche, la galerie occupe toute la largeur pour donner la place à l'auto, avec des boutons en verre au-dessus. Ce sont des gestes courants des applications mobiles ; ici, ils se posent sur une page blanche et une illustration maison, jamais sur une photo plein écran, avec notre mise en page et nos textes (voir §5).

### Motif signature : le _camino_

Un tracé de route en pointillés ronds, dans la couleur `focus`, qui évoque le nom (_camino_). Utilisé avec parcimonie, quatre fois : il **se dessine** sous l'auto de l'accueil, **relie** les trois étapes de « Cómo funciona », **trace l'itinéraire** sur la mini-carte (de « vous » à l'auto, et jusqu'au lieu de remise), et **ponctue** le squelette de chargement. Jamais en décor de fond, jamais plus d'une fois par écran visible.

### Mouvement

150 à 300 ms, courbe `cubic-bezier(.2, .7, .2, 1)`, sans rebond : apparition des écrans (280 ms) et des blocs au défilement (12 px + fondu, 280 ms), appui (160 ms), interrupteur (180 ms), survol (200 ms), transition carte → fiche (300 ms). Durée courte des jetons (`motion.duration.fast`, `--mf`) : 150 ms au moins dans toutes les directions. **Exceptions assumées** : le tracé du _camino_ se dessine en 700 ms une seule fois, le compteur de revenus monte en 700 ms, et le squelette de chargement balaie **trois fois** (1,4 s chacune) puis s'arrête. Avec `prefers-reduced-motion`, **tout s'arrête dans les écrans** : transitions et animations coupées, y compris survol, appui et interrupteur (aucun déplacement), contenu affiché directement, valeurs finales.

### Passage à US-030

Jetons à créer en plus des couleurs : `font.display` (famille, graisse, interlettrage, interligne par variante), `radius.card` (20 px), `shadow.card` et `shadow.float` (clair et sombre), `glass` (opacité 86 %, flou 18 px), `motion.*` (durées 160 / 280 / 300 / 700 ms, courbe), `avatar.tone.1-4` (clair et sombre), et le motif `camino` (tracé, pointillé 0,006 / 0,018, épaisseur 2,5 px).

## Positionnement entre particuliers (2026-11-02)

**Nouveau cap du fondateur (2026-11-02)** : Kmino est une plateforme de location de voitures **entre particuliers**. Des personnes mettent **leur** auto en location ; le visiteur doit le comprendre au premier coup d'œil. Les agences professionnelles peuvent être des hôtes parmi d'autres, sans être mises en avant. Cette section remplace « Positionnement marketplace » (version « agences », abandonnée le même jour avec sa signature « Compara agencias. Reserva con una. »).

**Ce qu'on prend, ce qu'on ne prend pas (CLAUDE.md, règle 9).** On s'inspire du **modèle** (location entre particuliers) et de ses principes d'ergonomie : l'auto précise plutôt qu'une catégorie, l'hôte visible, le lieu de remise convenu, l'espace du propriétaire. On ne reprend **rien de Turo** : ni identité visuelle, ni mise en page, ni textes, ni slogans, ni vocabulaire de marque (pas de « trips », de statut d'hôte ni de nom de programme). Toutes les formulations ci-dessous sont les nôtres, écrites en espagnol et en anglais.

### Signature de marque (3 options, PROPOSÉ)

Le produit sort en espagnol et en anglais en même temps : chaque signature est écrite pour sonner juste dans les deux langues, pas traduite mot à mot.

| #               | Espagnol (es)                              | Anglais (en)                            | Traduction française                           | Portugais du Brésil (pt)                       | Ce qu'elle fait passer                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------------ | --------------------------------------- | ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (recommandée) | **« Alquila el auto de un vecino. »**      | **« Rent a car from a neighbor. »**     | Louez la voiture d'un voisin.                  | « Alugue o carro de um vizinho. »              | Tout le modèle en six mots : une personne proche, son auto à elle. « Vecino » est chaleureux et compris partout en Amérique latine ; « neighbor » (anglais américain) garde la même image.                                                                                                          |
| 2               | « Autos de personas reales, cerca de ti. » | « Real people's cars, near you. »       | Des voitures de vrais gens, près de chez vous. | « Carros de gente de verdade, perto de você. » | « Personas reales » et la proximité. Plus descriptive, moins chaleureuse. Sert de base au sous-titre de l'accueil, élargi aux visiteurs : « Autos de personas reales cerca de ti, vivas aquí o estés de visita. » / « Real people's cars near you, whether you live here or you're just visiting. » |
| 3               | « Tu vecino tiene el auto que buscas. »    | « Your neighbor has the car you need. » | Votre voisin a la voiture qu'il vous faut.     | « Seu vizinho tem o carro que você procura. »  | La même idée que la 1, sous forme de promesse ; plus longue.                                                                                                                                                                                                                                        |

Portugais du Brésil (DEC-FONDATEUR-18, 2026-11-03) : signatures réécrites en pt-BR (« você », pas de portugais du Portugal), PROPOSÉES, à relire par l'agent UX ; `presentation.html` reste en ES / EN (il n'avait pas non plus de FR) : reprise à la prochaine itération des maquettes (passation US-014).

La signature 1 est le titre de l'accueil (S01) dans toutes les directions. « Vecino » parle d'abord aux habitants : le sous-titre ajoute les visiteurs. **Allégation à valider juridiquement avant la mise en ligne**, donc **non affichée** dans les maquettes (le surtitre par défaut est neutre : « Alquiler entre particulares · {country} » / « Peer-to-peer car rental · {country} ») : le surtitre « La primera plataforma de alquiler entre particulares de {country} » / « {country}'s first peer-to-peer car rental platform ». `{country}` est une donnée de pays, pas du texte en dur : PA → « Panamá » / « Panama », PY → « Paraguay ». À retirer si l'antériorité n'est pas démontrée.

**Bascule ES / EN dans `presentation.html`** : un sélecteur « ES / EN » dans la barre du haut et le bouton de langue (globe) de l'en-tête des maquettes changent tous les textes des quatre écrans. Les textes viennent de deux catalogues de **mêmes clés** (`es`, `en`) dans le script de la page, comme le paquet i18n ; au chargement, un contrôle de parité écrit `console.error` pour toute clé absente d'une langue, ou utilisée dans la page sans exister dans les deux. Ce n'est qu'un aperçu : la source de vérité sera le catalogue du produit.

### Ce qui change dans les maquettes (Lienzo en premier ; les quatre autres palettes partagent les mêmes écrans)

| Écran               | Repères « entre particuliers »                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S01 Accueil**     | Surtitre neutre « Alquiler entre particulares · Panamá » ; grand titre « Alquila el auto de un vecino. » ; sous-titre pour habitants et visiteurs ; **composition propre à chaque variante** (Azur : halo et auto entière au-dessus de la carte de l'hôte ; Tinta : bloc « nuit » avec verre dépoli ; Grafito : planche éditoriale légendée) ; tracé du _camino_ qui se dessine ; recherche flottante « Cerca de mí · San Francisco · 14–17 ene. », collante au défilement ; « Protección incluida en cada viaje* » (astérisque renvoyant à une note hors écran : contenu à confirmer) ; rail « Autos de vecinos cerca de ti » (5 autos, 4 silhouettes) ; citation de María ; « Cómo funciona » relié par le _camino_ ; « Gana dinero con tu auto » avec **estimateur à curseur** (2 à 20 jours, US$ 35 par jour, « no es una promesa de ingresos »). |
| **S02 Résultats**   | Barre de recherche en verre collante ; « 26 autos cerca de ti » ; tri segmenté Cercanía / Precio / Valoración ; mini-carte avec la position et le tracé jusqu'à l'auto choisie ; cartes d'**auto précise** (grande illustration, modèle et année, monogramme et prénom de l'hôte, note, quartier, distance, prix par jour et total), bouton « Guardar » ; **squelette de chargement**. Un toucher sur une carte ouvre la fiche avec une transition.                                                                                                                                                                                                                                                                                                                                                                                                   |
| **S02 · filtres**   | **Feuillet bas** : histogramme et curseur de prix, types d'auto, interrupteur « Solo anfitriones con identidad verificada », « Borrar » / « Ver 26 autos ».                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **S03 Fiche**       | Galerie bord à bord avec boutons en verre (retour, partager, guardar) ; grand titre « Kia Picanto » ; 4 caractéristiques à icônes ; **« Tu anfitriona »** (monogramme, membre depuis, réponses, « Identidad verificada », sa promesse entre guillemets) ; avis de Diego ; règles de l'hôte à icônes ; **lieu de remise** sur la mini-carte, deux choix ; prix total, annulation, protection* ; barre d'action en verre. Pas de « cobra Kmino » avant l'avis juridique (voir « Encaissement »).                                                                                                                                                                                                                                                                                                                                                        |
| **A02 Espace hôte** | « Hola, María » ; revenus du mois avec **compteur animé** et histogramme sur 6 mois ; demandes de réservation (Rechazar / Aceptar) ; « Mis autos » avec vignettes illustrées et statuts ; « Publicar otro auto ».                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Encaissement : défaut PROPOSÉ (DEC-FONDATEUR-14)

Ce n'est plus une question pour le fondateur. **DEC-FONDATEUR-14** fixe la règle : par défaut, faire comme Turo. Le **voyageur paie Kmino** ; **l'hôte est versé après le trajet** ; Kmino **vend la protection pour le compte d'un assureur partenaire** (DEC-FONDATEUR-13, Q-002). L'avis juridique sur la détention de fonds sera obtenu **avant la mise en service**. Analyse d'impact : PR #11, `docs/team/impact/2026-11-02-pivot-p2p.md`. À vérifier par les rôles argent et juridique ; `CLAUDE.md` (« l'agence encaisse ») sera révisé avec les specs.

Les maquettes restent prudentes : elles montrent le prix total et l'ITBMS, sans écrire « cobra Kmino », tant que l'avis juridique n'est pas rendu ; la mention « Protección incluida en cada viaje » porte un astérisque renvoyant à une note hors écran (« contenu à confirmer »).

### Garde-fous

- **Hôtes fictifs** : María G., Carlos R., Ana P., Luis M. (hôtes), Diego L. et Sarah K. (locataires), prénoms courants ; **avatars en monogrammes**, aucune photo de personne réelle ; autos dessinées par nous en SVG, aucune image téléchargée. Quartiers réels de Ciudad de Panamá (San Francisco, El Cangrejo, Costa del Este, Bella Vista), autos de modèles courants, prix d'exemple.
- **Professionnels** : une petite entreprise peut être hôte (pastille « Empresa » prévue), jamais mise en avant ; aucun nom réel.
- **Notes** : une petite étoile pleine (SVG générique en `currentColor`) et la note chiffrée, validée par la revue du 2026-11-03c ; **aucun badge de statut d'hôte**, seul « Identidad verificada ».
- **Protection** : « Protección incluida en cada viaje » / « Every trip is protected » est un **contenu à confirmer** (modèle d'assurance non tranché) : il porte la pastille « Por confirmar » dans les maquettes.
- **Rien de Turo** : formulations, mise en page et vocabulaire sont les nôtres ; palettes hors de la zone 230° à 300°.
- **Contrôles** (2026-11-02, après la revue 2026-11-03d) : à 375 × 812 et à 360 × 800, en espagnol et en anglais, en clair et en sombre (8 combinaisons), les sept directions dépliées : `scrollWidth` égal à la largeur, aucun élément hors de son écran, aucun écran qui défile en largeur ; **0 cible interactive sous 48 × 48 px** ; prix « US$ 28 /día » sur une ligne et libellés de recherche non tronqués ; auto de l'accueil entière et non recouverte (Tinta : seule l'ombre portée passe sous la carte) ; contraste du texte visible sur son fond effectif (verre `color(srgb … / α)` et dégradés compris, pire extrémité) : **0 échec** sur 1 531 nœuds texte des écrans et 4 590 avec le texte des panneaux, minimum 4,86:1 dans les écrans Lienzo ; console vide au chargement ; parité testée (une clé `en` retirée produit les `console.error` attendus).

---

## 1. Brief retenu (31 octobre, historique : modèle de loueurs professionnels, remplacé le 2026-11-02 par la location entre particuliers)

| Contrainte                                                                 | Ce qu'elle implique pour le nom et l'identité                                                                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marchés PA puis PY, et pro-first : les loueurs professionnels d'abord      | Le nom doit sonner sérieux pour une agence et rassurant pour un touriste. Il ne doit pas venir d'un argot propre à un seul pays.                                                                                      |
| Confiance (10b §3.0 : prix final, dates concrètes, argent bloqué expliqué) | Images de clé, de route, de repère ; un ton clair. Aucun effet d'urgence.                                                                                                                                             |
| Espagnol d'abord, espagnol neutre LATAM, tutoiement (10b §3.3)             | Le nom se prononce sans hésiter en espagnol. Il ne doit pas utiliser le _voseo_ (fréquent au Paraguay, mais exclu par UX-12).                                                                                         |
| Lisible en anglais (touristes, `en` complet)                               | Le nom n'a pas de son difficile pour un anglophone (_ll_, _rr_, _ñ_, _j_ initial) ou propose une graphie qui le contourne.                                                                                            |
| Concurrence (12 §1.5 et §10 ; 13)                                          | Le nom et l'identité doivent se distinguer des agrégateurs (Kayak, Rentcars, VIP Cars), des loueurs (Localiza, Hertz, Avis, Sixt, Automarket), des acteurs P2P régionaux (TripWip, Drivana, Kovi / Moove) et de Turo. |
| Identité propre (10b §3.0, principe 8)                                     | Aucune reprise de l'identité de Turo (§5).                                                                                                                                                                            |
| Données de thème (US-034, 10b §8)                                          | Le nom est le paramètre `{brand_name}` et le logo est un SVG stocké dans le thème. Les changer ne demande aucun développement.                                                                                        |

---

## 2. Méthode de contrôle de disponibilité et niveau de certitude

| Contrôle            | Méthode (2026-10-31)                                                                                                                           | Certitude                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.com`              | RDAP du registre Verisign (`rdap.verisign.com`) : 200 = enregistré, 404 = non enregistré                                                       | **Bonne** au moment du contrôle. Un domaine libre peut cependant être enregistré à tout moment, ou vendu au prix « premium ».                                     |
| `.app`              | RDAP de Google Registry (`pubapi.registry.google/rdap`)                                                                                        | Bonne, avec les mêmes réserves.                                                                                                                                   |
| `.lat`              | RDAP de CentralNic (`rdap.centralnic.com/lat`), serveur trouvé grâce au fichier d'amorçage de l'IANA                                           | Bonne, avec les mêmes réserves.                                                                                                                                   |
| `.com.pa`           | NIC Panama n'a pas de RDAP public. Nous avons interrogé les serveurs de noms (NS) via un résolveur public : NXDOMAIN signifie « aucun DNS »    | **Faible**. Un domaine peut être enregistré sans être délégué. À confirmer sur nic.pa.                                                                            |
| `.com.py`           | Même méthode. Le formulaire de nic.py n'est pas interrogeable automatiquement                                                                  | **Faible**. À confirmer sur nic.py.                                                                                                                               |
| Instagram et TikTok | Nous avons tenté d'ouvrir les profils sans être connectés. Les deux sites renvoient la même page qu'un compte existe ou non (mur de connexion) | **Non vérifié**. À contrôler à la main lors de la tâche F-20.                                                                                                     |
| Marques             | Recherche web rapide (sociétés et applications du même nom ou de secteurs voisins)                                                             | **Indicatif seulement : à confirmer par le fondateur** auprès de DIGERPI (Panama) et DINAPI (Paraguay), classes 39 (location de véhicules), 35 et 42. Tâche F-20. |

Contrôle témoin : un nom inventé (`qzxwvk9`) renvoie 404 sur les trois RDAP et NXDOMAIN sur les deux ccTLD. Les méthodes distinguent donc bien « libre » et « pris ».

**Constat** : aucun mot espagnol court et prononçable n'a de `.com` libre, ce qui était attendu. Nous proposons donc pour chaque nom un **domaine principal en `.lat`, `.com.pa` ou `.com.py`** et un **repli en `.com` composé** que nous avons vérifié libre (par exemple `yaveapp.com`).

---

## 3. Les dix noms

Légende : **libre** = non enregistré selon le RDAP du registre ; **pris** = enregistré ; **sans DNS** = aucun serveur de noms, donc probablement libre (non prouvé) ; **DNS actif** = déjà utilisé.

| #   | Nom         | Prononciation              | Sens et justification                                                                                                                                                                                                                         | Risques (es, guarani, en ; concurrents et grandes marques)                                                                                                                                                                                                                                                                                                                                                | .com | .app | .lat      | .com.pa  | .com.py   | Repli .com libre                               |
| --- | ----------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | --------- | -------- | --------- | ---------------------------------------------- |
| 1   | **Yave**    | « YA-vé » (en : _YAH-vay_) | Graphie phonétique de _llave_ (la clé). La remise des clés au comptoir est le moment de confiance du produit et le cœur des écrans agence (A02, A03). Nom court (4 lettres), distinctif, et plus facile à protéger qu'un mot du dictionnaire. | Peut passer pour une faute d'orthographe auprès de certains lecteurs hispanophones. **Yave** (yave.mx) est une fintech hypothécaire mexicaine : autre secteur (classe 36), mais même nom en Amérique latine. Au Paraguay, une partie des locuteurs prononce _ll_ différemment de _y_ (lleísmo), si bien que le lien avec _llave_ y est moins immédiat. Aucun sens négatif connu en guarani ni en anglais. | pris | pris | **libre** | sans DNS | sans DNS  | `yaveapp.com`, `yaveautos.com`, `holayave.com` |
| 2   | **Tramo**   | « TRA-mo »                 | Le tronçon de route : chaque location est une étape du voyage. Mot sobre et professionnel, compris dans toute l'Amérique latine et facile à dire en anglais.                                                                                  | Proche à l'oreille de _trampa_ (le piège). **TRAMI** est une application argentine de transport avec chauffeur. Comme mot courant, la marque est plus faible.                                                                                                                                                                                                                                             | pris | pris | **libre** | sans DNS | sans DNS  | `tramoautos.com`                               |
| 3   | **Volante** | « vo-LAN-té »              | Le volant : _al volante_ veut dire « prendre la route ». Compris immédiatement en espagnol et reconnaissable en anglais.                                                                                                                      | Très descriptif pour la location de voitures, donc une marque faible (risque de refus ou de faible portée en classe 39). « Volante » désigne aussi les versions cabriolet d'Aston Martin. _Volante_ veut également dire « prospectus ».                                                                                                                                                                   | pris | pris | **libre** | sans DNS | sans DNS  | `volanteapp.com`, `volanteautos.com`           |
| 4   | **Pista**   | « PIS-ta »                 | La piste, et aussi l'indice (_dar una pista_). Court et identique dans les deux langues.                                                                                                                                                      | Évoque la course et la vitesse, ce qui va contre la promesse de confiance. Pas de concurrent trouvé.                                                                                                                                                                                                                                                                                                      | pris | pris | **libre** | sans DNS | sans DNS  | `pistaautos.com`                               |
| 5   | **Senda**   | « SEN-da »                 | Le sentier : une image douce de chemin sûr.                                                                                                                                                                                                   | `senda.com.py` est déjà actif et le `.lat` est pris. L'anglais peut entendre « send a ». Le nom est déjà porté par plusieurs entreprises.                                                                                                                                                                                                                                                                 | pris | pris | pris      | sans DNS | DNS actif | `sendaautos.com`                               |
| 6   | **Faro**    | « FA-ro »                  | Le phare : un repère et de la confiance.                                                                                                                                                                                                      | Ville du Portugal, nom très répandu. `faro.com.py` est actif et aucun repli en `.com` testé n'est libre.                                                                                                                                                                                                                                                                                                  | pris | pris | pris      | sans DNS | DNS actif | aucun (`faroautos.com` est pris)               |
| 7   | **Rumbo**   | « ROUM-bo »                | Le cap, la direction (_tomar rumbo_). Nom fort.                                                                                                                                                                                               | **Risque élevé** : **Rumbo** (rumbo.es, groupe lastminute.com) est une agence de voyage en ligne qui vend de la location de voitures en espagnol. Le risque de confusion et d'opposition est réel.                                                                                                                                                                                                        | pris | pris | **libre** | sans DNS | sans DNS  | `rumboautos.com`                               |
| 8   | **Tranqui** | « TRAN-ki »                | « Tranquille » : la promesse d'une location sans surprise. Familier et sympathique.                                                                                                                                                           | Trop familier pour séduire des loueurs professionnels. L'anglais le prononce assez mal (_tran-kwee_).                                                                                                                                                                                                                                                                                                     | pris | pris | pris      | sans DNS | sans DNS  | `tranquiautos.com`                             |
| 9   | **Marcha**  | « MAR-tcha »               | _En marcha_ : en route, ça démarre.                                                                                                                                                                                                           | Évoque aussi la manifestation politique. En Espagne, _marcha_ veut dire « la fête ».                                                                                                                                                                                                                                                                                                                      | pris | pris | **libre** | sans DNS | sans DNS  | `marchaautos.com`                              |
| 10  | **Jaha**    | « dja-HA » en guarani      | « On y va » en guarani (forme inclusive) : un clin d'œil au Paraguay.                                                                                                                                                                         | Inconnu au Panama. L'espagnol le lit « ja-ja », c'est-à-dire un rire. **Le sens est à valider par un locuteur guarani.** `jaha.com.py` est actif et le `.lat` est pris.                                                                                                                                                                                                                                   | pris | pris | pris      | sans DNS | DNS actif | `jahaautos.com`                                |

Réseaux sociaux : **non vérifiés pour les dix noms**, voir le §2. Marques : **à confirmer par le fondateur (DIGERPI, DINAPI ; F-20)** pour les dix noms.

**Écartés pendant la recherche** (vérifiés, puis rejetés) :

- **Llave** : tous les domaines sont pris (`.com`, `.app`, `.lat`, `.com.py` actif). Yave en est la variante.
- **Clave** : c'est le nom du réseau de débit panaméen.
- **Rutaclara** : trop proche de **Claro**, l'opérateur télécom présent au Panama et au Paraguay, et `.com` / `.app` sont pris.
- **Listo** : Listo Insurance est un assureur automobile américain, et `.com.py` est actif.
- **Brío** : Honda Brio, jouets BRIO.
- **Arranca** : _arrancado_ veut dire « fauché » dans plusieurs pays d'Amérique latine.
- **Puente** et **Norte** : `.com.pa` est actif, et les mots sont trop génériques.
- **Rueda** : nom de code ; c'est aussi une appellation de vin espagnole, et la marque serait faible.

### 3.1 Classement et recommandation (31 octobre, pour mémoire : le fondateur a choisi Kmino le 2026-11-02)

Notes sur 5 (5 = meilleur). La « disponibilité » considère qu'un `.lat`, un ccTLD sans DNS et un repli `.com` libres valent mieux que l'absence de domaine.

| Rang | Nom     | Sens et confiance | Prononciation es / en | Risque (inverse) | Disponibilité | Total /20                                 |
| ---- | ------- | ----------------- | --------------------- | ---------------- | ------------- | ----------------------------------------- |
| 1    | Yave    | 5                 | 4                     | 4                | 4             | **17**                                    |
| 2    | Tramo   | 4                 | 5                     | 3                | 4             | **16**                                    |
| 3    | Volante | 4                 | 5                     | 2                | 4             | **15**                                    |
| 4    | Pista   | 3                 | 5                     | 3                | 4             | 15                                        |
| 5    | Senda   | 4                 | 4                     | 3                | 2             | 13                                        |
| 6    | Faro    | 4                 | 4                     | 3                | 1             | 12                                        |
| 7    | Rumbo   | 4                 | 4                     | 1                | 4             | 13 (rang abaissé : risque éliminatoire)   |
| 8    | Tranqui | 3                 | 3                     | 3                | 3             | 12                                        |
| 9    | Marcha  | 3                 | 4                     | 2                | 4             | 13 (rang abaissé : connotation politique) |
| 10   | Jaha    | 3                 | 2                     | 2                | 2             | 9                                         |

**Top 3 recommandé** :

1. **Yave** : c'est le nom le plus distinctif et le plus juste pour un produit centré sur le comptoir. Domaines visés : `yave.lat`, `yave.com.pa` et `yave.com.py` (à confirmer), avec le repli `yaveapp.com`.
2. **Tramo** : le choix le plus sobre et le plus « pro ». Domaines : `tramo.lat`, `.com.pa` et `.com.py` (à confirmer), avec le repli `tramoautos.com`.
3. **Volante** : le nom le plus immédiatement compris, mais aussi le plus difficile à protéger. Domaines : `volante.lat`, avec les replis `volanteapp.com` et `volanteautos.com`.

---

## 4. Trois directions visuelles (31 octobre, écartées par le fondateur le 2026-11-02)

> **Écartées** : le fondateur a jugé ces trois directions trop sombres le 2026-11-02. Elles restent ici pour mémoire ; les directions en cours sont dans « Palettes claires (2026-11-02) ».

Chaque direction est montrée dans `presentation.html` sur **S01** (accueil et recherche), **S03** (fiche véhicule) et **A02** (« Hoy en mostrador »), dans des cadres de téléphone de 360 px, en thème clair et en thème sombre (bouton en haut de la page). Les maquettes appliquent 10b : prix final avec ITBMS dès le départ, bloc « Depósito de garantía » qui nomme l'agence (UX-21, version Bêta), annulation en dates (UX-54), règle des 90 jours en texte fixe (UX-35 Bêta), une seule barre d'action en bas (UX-05), quatre statuts de comptoir (UX-39), aucun bouton désactivé (le bouton « Ver qué falta » remplace un bouton grisé, conformément à UX-50), cibles tactiles de 48 px au moins, et des statuts toujours accompagnés d'une icône et d'un texte (UX-48). Les noms d'agence et de client et les montants sont fictifs.

Le nom affiché dans chaque direction n'est qu'un exemple (Tierra firme avec Yave, Señal avec Tramo, Istmo avec Volante) : **toutes les combinaisons fonctionnent**.

Jetons communs aux trois directions : espacements de 4 à 40 px, cible tactile de 48 px, barre d'action de 72 px, tailles de texte de 13 à 36 px (corps de 17 px), interligne de 1,5. Toutes les polices viennent de **Google Fonts sous licence SIL OFL 1.1**.

### 4.1 Direction A — « Tierra firme » (chaleureuse, artisanale, proche)

- **Concept** : l'agence de quartier qu'on connaît depuis toujours, avec la rigueur d'un service moderne. La terre cuite et le sable rappellent les façades du Casco Viejo et la terre rouge du Paraguay ; le bleu-vert « laguna » sert aux repères (focus, liens secondaires).
- **Logo esquissé** : un anneau de clé et une tige à deux dents qui dessinent un _Y_, avec le mot « yave » en minuscules en Fraunces. SVG dans `tokens-tierra-firme.json → brand.logo`.
- **Palette** :

| Jeton          | Clair     | Sombre    | Usage                    |
| -------------- | --------- | --------- | ------------------------ |
| primary        | `#A23B1C` | `#F08A64` | action principale, liens |
| surface        | `#FBF6EF` | `#1A1411` | fond                     |
| surface-raised | `#FFFFFF` | `#251D18` | cartes, barre d'action   |
| text           | `#231B16` | `#F6EEE6` | texte                    |
| text-muted     | `#66564B` | `#C9B8AA` | texte secondaire         |
| accent         | `#0E6B6B` | `#5CC8C2` | repères, focus           |
| success        | `#2E6B2F` | `#7BCB7E` | statut positif           |
| danger         | `#B3261E` | `#FF8A80` | erreur                   |
| warning        | `#875400` | `#F2B84B` | en attente               |

- **Typographie** : titres en **Fraunces** 600 (serif à axe optique, voix humaine) ; texte et interface en **Figtree** 400 / 700.
- **Ton** (es, tutoiement) : « Tu precio final ya incluye ITBMS. Lo que ves es lo que pagas. » · « Te escribimos en cuanto la agencia confirme tu reserva. » · « No pudimos cargar los mostradores. Revisa tu conexión y vuelve a intentarlo. »
- **Style photo** : lumière chaude de fin de journée ; vraies personnes au comptoir, des mains qui tendent une clé ; voitures sur des fonds réels, jamais détourées. Pas de photos de banque d'images avec des sourires forcés.
- **Mouvement** : doux, de 160 à 240 ms, courbe ease-out (0.2, 0.7, 0.2, 1). Les feuilles montent de 12 px en fondu ; le prix recalculé « respire » une fois. Tout s'arrête avec `prefers-reduced-motion`.
- **Contrastes WCAG 2.2 AA** (calculés) :

| Paire                                 | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                       | 4.5:1 | `#231B16` / `#FBF6EF` | **15.75** OK | `#F6EEE6` / `#1A1411` | **15.88** OK |
| texte / carte                         | 4.5:1 | `#231B16` / `#FFFFFF` | **16.94** OK | `#F6EEE6` / `#251D18` | **14.43** OK |
| texte secondaire / surface            | 4.5:1 | `#66564B` / `#FBF6EF` | **6.52** OK  | `#C9B8AA` / `#1A1411` | **9.48** OK  |
| texte secondaire / carte              | 4.5:1 | `#66564B` / `#FFFFFF` | **7.01** OK  | `#C9B8AA` / `#251D18` | **8.61** OK  |
| texte du bouton / primaire            | 4.5:1 | `#FFFFFF` / `#A23B1C` | **6.61** OK  | `#1A1411` / `#F08A64` | **7.40** OK  |
| lien primaire / surface               | 4.5:1 | `#A23B1C` / `#FBF6EF` | **6.14** OK  | `#F08A64` / `#1A1411` | **7.40** OK  |
| lien primaire / carte                 | 4.5:1 | `#A23B1C` / `#FFFFFF` | **6.61** OK  | `#F08A64` / `#251D18` | **6.72** OK  |
| texte sur accent                      | 4.5:1 | `#FFFFFF` / `#0E6B6B` | **6.30** OK  | `#0B1F1F` / `#5CC8C2` | **8.53** OK  |
| succès (texte) / carte                | 4.5:1 | `#2E6B2F` / `#FFFFFF` | **6.44** OK  | `#7BCB7E` / `#251D18` | **8.43** OK  |
| danger (texte) / carte                | 4.5:1 | `#B3261E` / `#FFFFFF` | **6.54** OK  | `#FF8A80` / `#251D18` | **7.26** OK  |
| attention (texte) / carte             | 4.5:1 | `#875400` / `#FFFFFF` | **6.37** OK  | `#F2B84B` / `#251D18` | **9.26** OK  |
| succès / fond succès                  | 4.5:1 | `#2E6B2F` / `#E5F2E3` | **5.56** OK  | `#7BCB7E` / `#1E2E1D` | **7.30** OK  |
| danger / fond danger                  | 4.5:1 | `#B3261E` / `#FBE7E4` | **5.49** OK  | `#FF8A80` / `#3A1C19` | **6.76** OK  |
| attention / fond attention            | 4.5:1 | `#875400` / `#FDF0D8` | **5.65** OK  | `#F2B84B` / `#33260F` | **8.23** OK  |
| bordure de champ / carte              | 3.0:1 | `#8C796B` / `#FFFFFF` | **4.15** OK  | `#8C7A6D` / `#251D18` | **4.04** OK  |
| anneau de focus / surface             | 3.0:1 | `#0E6B6B` / `#FBF6EF` | **5.86** OK  | `#5CC8C2` / `#1A1411` | **9.11** OK  |
| anneau de focus / carte               | 3.0:1 | `#0E6B6B` / `#FFFFFF` | **6.30** OK  | `#5CC8C2` / `#251D18` | **8.28** OK  |
| composant primaire / surface (1.4.11) | 3.0:1 | `#A23B1C` / `#FBF6EF` | **6.14** OK  | `#F08A64` / `#1A1411` | **7.40** OK  |

_Info (clair) : accent / surface = 5.86:1 ; border décoratif / carte = 1.40:1 (non utilisé comme contour)._

_Info (sombre) : accent / surface = 9.11:1 ; border décoratif / carte = 1.33:1._

### 4.2 Direction B — « Señal » (précise, signalétique, outil pro)

- **Concept** : la signalétique routière et aéroportuaire : on lit vite et on se trompe peu. Le pétrole profond porte la confiance ; le vert-citron « lima » souligne seulement l'essentiel, en aplat sous un texte foncé. Les étapes sont numérotées (01, 02, 03) et les heures en chasse fixe. C'est la direction la plus naturelle pour le comptoir (A02) et pour les loueurs.
- **Logo esquissé** : un panneau carré dont la barre horizontale et la ligne de voie en pointillés forment un _T_, avec le mot « TRAMO » en Space Grotesk gras.
- **Palette** :

| Jeton          | Clair     | Sombre    | Usage                               |
| -------------- | --------- | --------- | ----------------------------------- |
| primary        | `#0B4F6C` | `#6FC3E6` | action principale, liens            |
| surface        | `#F4F6F7` | `#0B141A` | fond                                |
| surface-raised | `#FFFFFF` | `#132029` | cartes                              |
| text           | `#0E1A22` | `#EAF2F5` | texte                               |
| text-muted     | `#4A5963` | `#A7B6BE` | texte secondaire                    |
| accent         | `#C8F03C` | `#C8F03C` | surlignage (aplat sous `on-accent`) |
| success        | `#1B6B39` | `#5FD38A` | statut positif                      |
| danger         | `#B42318` | `#FF8B7E` | erreur                              |
| warning        | `#855300` | `#F5B94A` | en attente                          |

- **Règle d'accent** : en thème clair, le citron n'a qu'un contraste de **1,21:1** avec la surface. Il sert donc **uniquement d'aplat sous le texte `on-accent`** (contraste de 13,44:1) et n'est jamais le seul indicateur d'un état ou d'un composant.
- **Typographie** : titres en **Space Grotesk** 700 ; texte en **IBM Plex Sans** 400 / 600 ; heures, codes et libellés en **IBM Plex Mono** 500.
- **Ton** (direct, précis) : « Total: US$ 181.90. Sin cargos al llegar. » · « Pago confirmado. Ya puedes entregar las llaves. » · « Falta firmar el contrato. Ábrelo y pide la firma al cliente. »
- **Style photo** : lumière nette de jour, cadrages réguliers de face et de trois quarts comme une fiche technique, plaque floutée ; au comptoir, l'écran et les mains de l'agent ; fonds neutres réels.
- **Mouvement** : rapide et mécanique, de 120 à 200 ms, sans rebond. Les statuts changent par un fondu de couleur ; la ligne de voie avance pendant les chargements (squelettes). Le mouvement est réduit à des fondus si l'utilisateur le demande.
- **Contrastes WCAG 2.2 AA** (calculés) :

| Paire                                 | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                       | 4.5:1 | `#0E1A22` / `#F4F6F7` | **16.29** OK | `#EAF2F5` / `#0B141A` | **16.40** OK |
| texte / carte                         | 4.5:1 | `#0E1A22` / `#FFFFFF` | **17.65** OK | `#EAF2F5` / `#132029` | **14.62** OK |
| texte secondaire / surface            | 4.5:1 | `#4A5963` / `#F4F6F7` | **6.68** OK  | `#A7B6BE` / `#0B141A` | **8.92** OK  |
| texte secondaire / carte              | 4.5:1 | `#4A5963` / `#FFFFFF` | **7.24** OK  | `#A7B6BE` / `#132029` | **7.96** OK  |
| texte du bouton / primaire            | 4.5:1 | `#FFFFFF` / `#0B4F6C` | **8.94** OK  | `#0B141A` / `#6FC3E6` | **9.41** OK  |
| lien primaire / surface               | 4.5:1 | `#0B4F6C` / `#F4F6F7` | **8.25** OK  | `#6FC3E6` / `#0B141A` | **9.41** OK  |
| lien primaire / carte                 | 4.5:1 | `#0B4F6C` / `#FFFFFF` | **8.94** OK  | `#6FC3E6` / `#132029` | **8.39** OK  |
| texte sur accent                      | 4.5:1 | `#0E1A22` / `#C8F03C` | **13.44** OK | `#0B141A` / `#C8F03C` | **14.16** OK |
| succès (texte) / carte                | 4.5:1 | `#1B6B39` / `#FFFFFF` | **6.54** OK  | `#5FD38A` / `#132029` | **8.82** OK  |
| danger (texte) / carte                | 4.5:1 | `#B42318` / `#FFFFFF` | **6.57** OK  | `#FF8B7E` / `#132029` | **7.30** OK  |
| attention (texte) / carte             | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#132029` | **9.41** OK  |
| succès / fond succès                  | 4.5:1 | `#1B6B39` / `#E2F3E8` | **5.68** OK  | `#5FD38A` / `#11281B` | **8.32** OK  |
| danger / fond danger                  | 4.5:1 | `#B42318` / `#FDE8E6` | **5.59** OK  | `#FF8B7E` / `#33171A` | **7.23** OK  |
| attention / fond attention            | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte              | 3.0:1 | `#76868F` / `#FFFFFF` | **3.77** OK  | `#6A7F8A` / `#132029` | **3.96** OK  |
| anneau de focus / surface             | 3.0:1 | `#0B4F6C` / `#F4F6F7` | **8.25** OK  | `#C8F03C` / `#0B141A` | **14.16** OK |
| anneau de focus / carte               | 3.0:1 | `#0B4F6C` / `#FFFFFF` | **8.94** OK  | `#C8F03C` / `#132029` | **12.62** OK |
| composant primaire / surface (1.4.11) | 3.0:1 | `#0B4F6C` / `#F4F6F7` | **8.25** OK  | `#6FC3E6` / `#0B141A` | **9.41** OK  |

_Info (clair) : accent / surface = 1.21:1 ; border décoratif / carte = 1.38:1 (non utilisé comme contour)._

_Info (sombre) : accent / surface = 14.16:1 ; border décoratif / carte = 1.33:1._

### 4.3 Direction C — « Istmo » (tropicale moderne, lumineuse, accessible)

- **Concept** : l'isthme, un passage entre deux océans, comme la plateforme relie agences et voyageurs. Le vert jungle profond et l'orange mangue donnent de l'optimisme sans faire « carte postale ». La police de texte, **Atkinson Hyperlegible**, a été conçue par le Braille Institute pour les lecteurs malvoyants : c'est un argument d'accessibilité concret. Les grandes surfaces sont arrondies et les gros boutons en forme de pilule ; l'en-tête est de couleur pleine et se termine par une courbe.
- **Logo esquissé** : un cercle de volant avec un _V_ à l'intérieur, et le mot « Volante » en Bricolage Grotesque très gras.
- **Palette** :

| Jeton          | Clair     | Sombre    | Usage                                       |
| -------------- | --------- | --------- | ------------------------------------------- |
| primary        | `#0F5C4A` | `#5FD0AE` | action principale, en-tête                  |
| surface        | `#FFFBF5` | `#0C1613` | fond                                        |
| surface-raised | `#FFFFFF` | `#15231F` | cartes                                      |
| text           | `#13221D` | `#EEF5F1` | texte                                       |
| text-muted     | `#4D5E58` | `#A9BBB4` | texte secondaire                            |
| accent         | `#F2873A` | `#FFA45C` | badges, surlignage (aplat sous `on-accent`) |
| success        | `#2B6A1E` | `#86D97A` | statut positif                              |
| danger         | `#B3261E` | `#FF8A80` | erreur                                      |
| warning        | `#855300` | `#F5B94A` | en attente                                  |

- **Règle d'accent** : en thème clair, le mangue a un contraste de **2,45:1** avec la surface. Il sert donc seulement d'aplat sous `on-accent` (contraste de 7,30:1) et n'est jamais le seul indicateur d'un état.
- **Typographie** : titres en **Bricolage Grotesque** 800 ; texte et interface en **Atkinson Hyperlegible** 400 / 700.
- **Ton** (optimiste, clair) : « Elige tu mostrador y arranca. » · « Cancelación gratuita hasta el jue. 13 ene., 10:00. » · « Listo: tu reserva está confirmada. Te esperamos el vie. 14 ene. a las 10:00. »
- **Style photo** : lumière tropicale franche, ciel et végétation ; la voiture en situation (route côtière, Asunción au crépuscule) ; des touristes et des résidents de profils variés ; saturation naturelle.
- **Mouvement** : vivant mais bref, de 180 à 260 ms. Un léger rebond (0.34, 1.3, 0.64, 1) est réservé aux confirmations. Le mouvement est réduit à des fondus si l'utilisateur le demande.
- **Risque de proximité** : la famille du vert est celle de **Localiza** (premier concurrent et partenaire possible au Paraguay, 13 §R8) ainsi que d'Europcar et d'Enterprise. Le vert d'Istmo est plus sombre et associé au mangue, mais il faudra le vérifier côte à côte avant de choisir.
- **Contrastes WCAG 2.2 AA** (calculés) :

| Paire                                 | Seuil | Clair (couleurs)      | Clair        | Sombre (couleurs)     | Sombre       |
| ------------------------------------- | ----- | --------------------- | ------------ | --------------------- | ------------ |
| texte / surface                       | 4.5:1 | `#13221D` / `#FFFBF5` | **15.99** OK | `#EEF5F1` / `#0C1613` | **16.64** OK |
| texte / carte                         | 4.5:1 | `#13221D` / `#FFFFFF` | **16.48** OK | `#EEF5F1` / `#15231F` | **14.68** OK |
| texte secondaire / surface            | 4.5:1 | `#4D5E58` / `#FFFBF5` | **6.66** OK  | `#A9BBB4` / `#0C1613` | **9.17** OK  |
| texte secondaire / carte              | 4.5:1 | `#4D5E58` / `#FFFFFF` | **6.87** OK  | `#A9BBB4` / `#15231F` | **8.09** OK  |
| texte du bouton / primaire            | 4.5:1 | `#FFFFFF` / `#0F5C4A` | **7.92** OK  | `#0C1613` / `#5FD0AE` | **9.76** OK  |
| lien primaire / surface               | 4.5:1 | `#0F5C4A` / `#FFFBF5` | **7.69** OK  | `#5FD0AE` / `#0C1613` | **9.76** OK  |
| lien primaire / carte                 | 4.5:1 | `#0F5C4A` / `#FFFFFF` | **7.92** OK  | `#5FD0AE` / `#15231F` | **8.61** OK  |
| texte sur accent                      | 4.5:1 | `#1B120B` / `#F2873A` | **7.30** OK  | `#1B120B` / `#FFA45C` | **9.42** OK  |
| succès (texte) / carte                | 4.5:1 | `#2B6A1E` / `#FFFFFF` | **6.60** OK  | `#86D97A` / `#15231F` | **9.46** OK  |
| danger (texte) / carte                | 4.5:1 | `#B3261E` / `#FFFFFF` | **6.54** OK  | `#FF8A80` / `#15231F` | **7.12** OK  |
| attention (texte) / carte             | 4.5:1 | `#855300` / `#FFFFFF` | **6.49** OK  | `#F5B94A` / `#15231F` | **9.23** OK  |
| succès / fond succès                  | 4.5:1 | `#2B6A1E` / `#E6F2E1` | **5.70** OK  | `#86D97A` / `#16281A` | **9.03** OK  |
| danger / fond danger                  | 4.5:1 | `#B3261E` / `#FBE7E4` | **5.49** OK  | `#FF8A80` / `#36191A` | **7.02** OK  |
| attention / fond attention            | 4.5:1 | `#855300` / `#FCEFD6` | **5.71** OK  | `#F5B94A` / `#2E2410` | **8.66** OK  |
| bordure de champ / carte              | 3.0:1 | `#7A8A84` / `#FFFFFF` | **3.62** OK  | `#667A73` / `#15231F` | **3.56** OK  |
| anneau de focus / surface             | 3.0:1 | `#0F5C4A` / `#FFFBF5` | **7.69** OK  | `#FFA45C` / `#0C1613` | **9.40** OK  |
| anneau de focus / carte               | 3.0:1 | `#0F5C4A` / `#FFFFFF` | **7.92** OK  | `#FFA45C` / `#15231F` | **8.29** OK  |
| composant primaire / surface (1.4.11) | 3.0:1 | `#0F5C4A` / `#FFFBF5` | **7.69** OK  | `#5FD0AE` / `#0C1613` | **9.76** OK  |

_Info (clair) : accent / surface = 2.45:1 ; border décoratif / carte = 1.35:1 (non utilisé comme contour)._

_Info (sombre) : accent / surface = 9.40:1 ; border décoratif / carte = 1.35:1._

### 4.4 Règles communes de contraste

- Seuils appliqués : 4,5:1 pour tout texte, et 3:1 pour les contours de composants et l'anneau de focus (WCAG 1.4.3 et 1.4.11). **Les 108 paires (18 paires × 2 thèmes × 3 directions) passent toutes.** Le calcul utilise la formule de luminance relative WCAG 2.x ; le script est reproductible et les résultats figurent dans `contrastChecks` de chaque JSON.
- Le jeton `border` (environ 1,3 à 1,4:1) sert **seulement aux séparateurs décoratifs**. Tout contour qui identifie un composant (champ, bouton secondaire) utilise `border-strong`.
- L'état n'est jamais indiqué par la couleur seule : chaque pastille a une icône et un texte (UX-48).
- À vérifier ensuite (US-030, US-032) : contrastes des états de survol et d'appui, de la photo sous le badge « 1 / 12 fotos », et du texte agrandi à 200 %.

---

## 5. Contrôle anti-Turo (31 octobre, avec la mise à jour du 2026-11-02)

**Ce que nous savons de l'identité de Turo** (de mémoire et de sources secondaires, sans consulter sa charte officielle ; nous n'avons téléchargé ni copié aucun visuel) : refonte de 2015 par DesignStudio, avec un mot-symbole en lettrage propriétaire sans-serif, en minuscules ; couleur signature dans la famille **violet-indigo** depuis plusieurs années (non confirmé sur source primaire) ; accueil avec une grande photo et une recherche superposée ; cartes de véhicule avec note en étoiles et badges d'hôte (« All-Star Host »). Par prudence, **nous excluons toute teinte entre 230° et 300°** (violets et indigos) des trois palettes.

| Point                        | Tierra firme                                                                                                                                        | Señal                                                                                            | Istmo                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Couleur signature            | Primaire terre cuite `#A23B1C` (≈ 14°), accent laguna (≈ 180°). **Conforme**                                                                        | Primaire pétrole `#0B4F6C` (≈ 198°), accent citron (≈ 74°). **Conforme**                         | Primaire jungle `#0F5C4A` (≈ 166°), accent mangue (≈ 25°). **Conforme**                                                           |
| Logo                         | Pictogramme de clé formant un Y, et mot-symbole serif. **Conforme**                                                                                 | Panneau carré avec ligne de voie formant un T, et mot-symbole en capitales. **Conforme**         | Cercle de volant avec un V, et mot-symbole grotesque gras. **Conforme**                                                           |
| Typographie                  | Fraunces et Figtree (OFL). **Conforme**                                                                                                             | Space Grotesk et IBM Plex (OFL). **Conforme**                                                    | Bricolage Grotesque et Atkinson Hyperlegible (OFL). **Conforme**                                                                  |
| Mise en page caractéristique | Recherche dans une carte du flux, sur un motif topographique ; pas de photo plein écran ni de barre de recherche en pilule par-dessus. **Conforme** | Recherche en 3 étapes numérotées avec une ligne de voie ; aucun visuel plein écran. **Conforme** | En-tête de couleur pleine terminé par une courbe, et carte de recherche qui le chevauche ; pas de photo plein écran. **Conforme** |
| Libellés et programmes       | Aucun (« Nuevo · sin reseñas » et nombre de trips, 10b REV-010). **Conforme**                                                                       | Aucun ; nos statuts de comptoir (UX-39). **Conforme**                                            | Aucun ; badge « Nuevo » qui est le nôtre. **Conforme**                                                                            |
| Fiche véhicule               | Aucune note en étoiles ni badge d'hôte ; prix final et caution **avant** les avis (10b AM13). **Conforme**                                          | Idem. **Conforme**                                                                               | Idem. **Conforme**                                                                                                                |

Le relecteur UX indépendant devra confirmer ce contrôle visuellement.

**Mise à jour du 2026-11-02 (location entre particuliers).** La règle « aucune note en étoiles » du tableau ci-dessus est levée à la demande du fondateur, et la revue du 2026-11-03c l'a validée : la note est affichée avec une petite étoile pleine, dessinée par nous en SVG générique (`currentColor`), et un chiffre (« 4.9 · 54 alquileres »). Restent exclus : les badges de statut d'hôte et les noms de programme ; seule la pastille « Identidad verificada », un fait vérifiable, est montrée. La zone violet-indigo reste exclue ; la mise en page, les textes et le vocabulaire sont les nôtres (voir « Langage visuel »). La recherche flottante de l'accueil et la galerie bord à bord de la fiche reprennent des gestes courants des applications mobiles, pas la composition de Turo : elles se posent sur une page blanche et des illustrations maison, jamais sur une grande photo ; chaque case « Contrôle anti-Turo » des sept directions le dit, avec l'étoile.

---

## 6. Nom et logo comme données de thème (US-034) et passage à US-030

- Chaque `tokens-<direction>.json` suit le **format DTCG** (brouillon du W3C Community Group) : `color.light` et `color.dark` (18 jetons chacun), `font`, `space`, `size`, `radius`, `shadow`, `motion`, `brand` et `contrastChecks`.
- `brand.name` vaut `{brand_name}` (paramètre) ; `brand.exampleName` donne le nom des maquettes ; `brand.logo` contient le SVG du logo, en `currentColor` pour suivre le thème.
- US-030 pourra compiler ces fichiers en variables CSS et réutiliser `contrastChecks` comme jeu de tests de son contrôle de contraste.

---

## 7. Grille de choix du fondateur

**Le nom est choisi (Kmino). Il reste à choisir 1 direction** parmi les quatre palettes claires et les trois variantes blanc épuré.

| Choix       | Options                                                                                                                           | Recommandation                                                                                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nom         | **Kmino** (tranché le 2026-11-02)                                                                                                 | Acquis ; F-20 avant publication                                                                                                                                                                                                                                |
| Direction   | D « Cielo » · E « Marina » · F « Voltio » · G « Lagune » · H1 « Lienzo · Tinta » · H2 « Lienzo · Azur » · H3 « Lienzo · Grafito » | **Cielo** (PROPOSÉ) : la plus claire, une seule teinte, le bleu ne sert qu'à agir. **Marina** est la plus premium, **Voltio** la plus contrastée, **Lagune** la plus souriante. Pour un vrai fond blanc : **Lienzo · Azur** (fraîche) ou **Tinta** (élégante). |
| Ajustements | Nuance du bleu, police, accent, rayons, etc.                                                                                      | Possibles sans développement après US-030 et US-034                                                                                                                                                                                                            |
| Signature   | 3 options (« Positionnement entre particuliers »)                                                                                 | « Alquila el auto de un vecino. » / « Rent a car from a neighbor. » (PROPOSÉ)                                                                                                                                                                                  |
| Écartées    | A « Tierra firme » · B « Señal » · C « Istmo » (31 octobre)                                                                       | Écartées par le fondateur le 2026-11-02 (trop sombres)                                                                                                                                                                                                         |

**Défaut en attendant le choix (DEC-MARQUE)** : `{brand_name}` = `Kmino` ; direction **Cielo** (PROPOSÉ, `tokens-cielo.json`). US-030 peut démarrer avec ces jetons et basculer ensuite vers une autre palette sans développement.

**Après le choix** :

1. Consigner la direction dans le journal des décisions (DEC-MARQUE, alimente US-030).
2. **F-20 (fondateur)** : recherche d'antériorité DIGERPI et DINAPI (classes 39, 35 et 42), achat des domaines (`.lat`, `.com.pa`, `.com.py` et le repli `.com`), réservation des comptes Instagram et TikTok, **avant** toute publication du nom.
3. Faire relire la microcopie et la prononciation de Kmino par une personne panaméenne et une personne paraguayenne.

---

## 8. Incertitudes

- Disponibilité des `.com.pa` et `.com.py` déduite seulement de l'absence de DNS ; réseaux sociaux non vérifiés.
- Marques : aucune recherche dans les bases officielles. Il ne s'agit que d'une recherche web.
- Identité de Turo décrite de mémoire et d'après des sources secondaires. L'exclusion de toute la zone violet-indigo couvre ce doute.
- Le sens de « Jaha » et la prononciation de « Yave » au Paraguay restent à valider auprès de locuteurs.
- Maquettes : elles ne sont pas testées avec un lecteur d'écran, et le rendu des polices dépend du chargement de Google Fonts.
- Palettes claires : les contrastes des états de survol et d'appui, de la photo sous le badge « 1 / 12 fotos » et du texte agrandi à 200 % restent à vérifier (US-030, US-032). La proximité de Marina et de Voltio avec les bleus de grands sites de voyage est une impression, pas une étude.
