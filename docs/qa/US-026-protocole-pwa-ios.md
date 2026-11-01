# US-026 : protocole de test de la PWA sur iPhone (comptoir)

> Pour : le fondateur et les agences pilotes. Aucune connaissance technique n'est nécessaire.
> Références : 19 US-026, TRP-056, TRP-057 (04), 17 §6.2, ADR-005, ADR-039, risque P-04 (`docs/team/RISKS.md`).

## 1. Pourquoi ce test

Au comptoir, l'agent photographie le véhicule à la remise et au retour. Ces photos servent de preuve en cas de litige : elles doivent être prises **à l'instant**, sans possibilité de choisir une ancienne photo de la galerie. Nous avons choisi une application web installable (PWA, ADR-039) plutôt qu'une application de l'App Store. Sur iPhone, une PWA a des limites connues : la galerie peut être proposée, Safari peut effacer les données stockées, l'envoi en arrière-plan n'existe pas.

Ce test vérifie, **sur les vrais téléphones des agences**, si la PWA suffit. À la fin du lot 0, vous déciderez (§8) entre :

- **PWA seule** ;
- **enveloppe native** pour le comptoir seulement (la même application emballée et publiée sur l'App Store et le Play Store, avec revue Apple : délai et coût en plus) ;
- **terminal fourni** : un téléphone Android remis à chaque comptoir.

Le parcours des clients (guest) reste un site web dans tous les cas. Aucun développement n'attend ce test : le comptoir se construit en PWA, et un repli ne changerait que trois briques isolées (caméra, file hors ligne, position).

## 2. Appareils à couvrir

Minimum : les quatre lignes ci-dessous. Si une agence a un autre modèle courant, ajoutez une ligne.

| Code | Appareil                                                   | Version            | Pourquoi                                             |
| ---- | ---------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| A    | iPhone récent d'une agence                                 | iOS 26 (dernière)  | cas le plus courant                                  |
| B    | iPhone plus ancien d'une agence                            | iOS 18             | version précédente, encore très répandue             |
| C    | **petit iPhone** (SE 2e ou 3e génération, ou mini)         | la sienne          | petit écran exigé par la story ; caméra plus modeste |
| D    | téléphone Android du comptoir (ou celui qui serait fourni) | Android 13 ou plus | comparaison, et base de l'option « terminal fourni » |

Pour chaque iPhone, faites les tests **deux fois** : dans un onglet **Safari**, puis dans l'application **installée sur l'écran d'accueil** (test 10). Sur iPhone, les deux ont des données séparées, et c'est l'application installée qui compte pour le comptoir.

Pour lire la version d'iOS : **Réglages > Général > Informations > Version d'iOS**. Notez-la : celle qu'affiche la page peut être fausse (Safari la masque parfois).

## 3. Ouvrir la page sur le téléphone

La page de test est `/lab/pwa-ios`. Elle est coupée par défaut et n'existe jamais en production (drapeau `WEB_LAB_PWA_IOS_ENABLED`, voir `apps/web/README.md`).

### Option A : en local, sur le Wi-Fi (répétition seulement)

> **Attention : sans HTTPS, l'iPhone bloque la caméra en direct, le service worker, la position et le chiffrement.** En local, seuls les tests 1, 3 et 10 ont un sens, et la page affiche un avertissement. Les résultats qui comptent pour la décision viennent de l'option B.

1. Le PC et le téléphone sont sur **le même Wi-Fi**.
2. Sur le PC, dans PowerShell, à la racine du dépôt :
   ```powershell
   pnpm --filter @rueda/web build
   $env:WEB_LAB_PWA_IOS_ENABLED = 'true'; pnpm --filter @rueda/web start
   ```
3. Trouver l'adresse IP du PC : commande `ipconfig`, ligne « Adresse IPv4 » de la carte Wi-Fi (par exemple `192.168.1.23`).
4. Si Windows demande d'autoriser Node.js sur le réseau, n'acceptez que **réseaux privés**. C'est un réglage de votre PC : faites-le vous-même.
5. Sur l'iPhone, dans Safari : `http://192.168.1.23:3000/lab/pwa-ios` (remplacez par votre IP).
6. À la fin, fermez la fenêtre PowerShell : la page disparaît.

### Option B : la préproduction en HTTPS (campagne officielle)

La préproduction n'existe pas encore (US-003). Une fois en place, l'équipe active le drapeau **en préproduction seulement**, le temps de la campagne, et vous envoie l'adresse `https://…/lab/pwa-ios`. C'est avec cette option que se fait le test décisif.

Une troisième voie existe : un tunnel HTTPS temporaire vers le PC. Elle demande d'installer un outil et d'exposer le PC à Internet. Elle n'est **pas** prévue : il faudrait votre accord et une revue de sécurité.

## 4. Déroulé (environ 30 minutes par appareil, plus un retour au 8e jour)

Ouvrez la page, puis lancez les tests **dans l'ordre**. Sous chaque bouton, un bloc de texte (JSON) s'affiche avec un état entre crochets :

- `[pass]` : réussi ;
- `[fail]` : échec ;
- `[warn]` : à risque ;
- `[info]` : relevé, sans verdict.

Le bouton **Copier** copie un bloc. À la fin, **Copier le rapport complet** copie le tout : collez-le dans une note ou un courriel et joignez-le à la grille (§6).

| N°  | Test                       | À faire                                                                                                                                                                              | À noter                                                                           |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1   | Environnement              | « Lancer ».                                                                                                                                                                          | rien (relevé automatique) ; vérifier `isSecureContext: true` en option B          |
| 2   | Caméra en direct           | « Ouvrir la caméra », accepter l'autorisation, viser une voiture, « Prendre la photo ». Recommencer dehors en plein soleil et dans un endroit sombre.                                | la caméra arrière s'ouvre-t-elle **dans la page** ? photo nette ? poids et taille |
| 3   | Entrée fichier « capture » | Toucher le bouton de fichier. Si un menu propose la **photothèque**, toucher « oui », sinon « non ». Puis réessayer en choisissant une **ancienne** photo de la galerie.             | iOS a-t-il proposé la photothèque ? l'ancienne photo est-elle signalée `[fail]` ? |
| 4   | Stockage persistant        | « Lancer ».                                                                                                                                                                          | `persistGranted` (vrai ou faux)                                                   |
| 5   | Purge du stockage          | **Jour 0** : « Écrire le témoin ». Notez la date. **Ne rouvrez plus la page.** **Jour 8 ou plus** : rouvrez-la, « Lire le témoin ». À faire dans Safari **et** dans l'app installée. | date du jour 0 ; résultat au jour 8                                               |
| 6   | File hors ligne chiffrée   | Après le test 2, « Ajouter à la file » deux fois. **Fermez complètement** l'application (balayer vers le haut). Rouvrez-la, « Lister et vérifier ». Puis « Vider (envoi simulé) ».   | les éléments sont-ils toujours là après fermeture ? `verified` tout à `true` ?    |
| 7   | Géolocalisation            | « Lancer », accepter l'autorisation. Une fois au comptoir (intérieur), une fois dehors.                                                                                              | `accuracyM` (précision en mètres) et `elapsedMs` (délai)                          |
| 8   | Service worker             | « Enregistrer et vérifier ». Recharger la page, relancer. Puis **mode avion**, recharger la page.                                                                                    | la page s'affiche-t-elle en mode avion ?                                          |
| 9   | Synchronisation            | « Lancer ».                                                                                                                                                                          | attendu sur iPhone : `[warn]`, non disponible                                     |
| 10  | Installation               | Safari > bouton **Partager** > **Sur l'écran d'accueil** > Ajouter. Ouvrir depuis l'icône (plein écran, sans barre Safari). « Lancer ».                                              | l'icône apparaît-elle ? ouverture plein écran ? `[pass]`                          |
| 11  | Petit écran (appareil C)   | Parcourir toute la page.                                                                                                                                                             | tout est-il lisible, sans défilement de côté ?                                    |

Après le test 10, refaites les tests 2 à 9 **depuis l'icône** (l'application installée).

## 5. Critères de réussite

| Critère                      | Réussi si                                                                                                             | Bloquant pour « PWA seule » ?                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| C1 Caméra en direct (test 2) | la caméra arrière s'ouvre dans la page, sans galerie ; photo ≤ 500 ko et ≤ 1 600 px (`overBudget: false`), nette      | **oui** : c'est la preuve                                            |
| C2 Entrée fichier (test 3)   | relevé seulement. On s'attend à ce qu'iOS propose la photothèque : c'est pourquoi l'application ne l'utilisera jamais | non (risque confirmé, contourné par C1)                              |
| C3 Purge (tests 4 et 5)      | dans l'**app installée**, les trois témoins sont présents après 8 jours ou plus (`[pass]`)                            | oui pour le hors ligne (TRP-057, P0-A) ; non pour la Bêta (en ligne) |
| C4 File et reprise (test 6)  | après fermeture complète, les éléments sont là et vérifiés ; le vidage se termine `failed: null`                      | oui pour le hors ligne (P0-A) ; non pour la Bêta                     |
| C5 Position (test 7)         | une position en moins de 15 s ; précision ≤ 100 m au comptoir (seuil PROPOSÉ)                                         | non seul ; à signaler si aucune position n'est jamais obtenue        |
| C6 Hors ligne (test 8)       | la page s'affiche en mode avion depuis l'app installée                                                                | oui pour le hors ligne (P0-A) ; non pour la Bêta                     |
| C7 Synchronisation (test 9)  | relevé seulement : absente sur iPhone. Conséquence : l'envoi se fait quand l'application est ouverte                  | non (contournement prévu)                                            |
| C8 Installation (test 10)    | icône sur l'écran d'accueil, ouverture plein écran, `[pass]`                                                          | oui (C3, C4 et C6 en dépendent)                                      |
| C9 Petit écran (test 11)     | tout est lisible et utilisable sur l'appareil C                                                                       | non : c'est un défaut d'écran, corrigé en développement              |

## 6. Gabarit de résultat (une copie par appareil)

```text
Appareil (code et modèle) :              ex. C — iPhone SE 3e génération
Version d'iOS / Android (Réglages) :     ex. 18.6.2
Agence, testeur, date :
Mode d'ouverture :                       préproduction HTTPS / local Wi-Fi
                                         Safari   |   App installée
C1 Caméra en direct      (✔ / ✘ / —)     ....     |   ....      poids : ..... ko  taille : ....x....
C2 Photothèque proposée  (oui / non)     ....     |   ....      ancienne photo signalée : oui / non
C3 Purge, jour 0 → jour 8 (✔ / ✘)        ....     |   ....      date jour 0 : ..../..../....
C4 File et reprise       (✔ / ✘)         ....     |   ....
C5 Position              (✔ / ✘)         ....     |   ....      précision : .... m   délai : .... s
C6 Mode avion            (✔ / ✘)         ....     |   ....
C7 Synchronisation       (disponible ?)  ....     |   ....
C8 Installation          (✔ / ✘)           —      |   ....
C9 Petit écran           (✔ / ✘ / —)     ....
Remarques (ce qui a surpris, captures d'écran) :
Rapport JSON joint :                     oui / non
```

## 7. Ce que l'équipe d'agents n'a pas pu vérifier

L'agent a écrit la page et l'a testée sur un PC, dans Chrome, sans iPhone. Vérifié :

- la logique, par 53 tests automatiques ;
- le drapeau : 404 partout s'il est coupé ;
- l'enregistrement du service worker, l'événement de synchronisation et la réouverture de la page serveur arrêté ;
- la file chiffrée et le témoin de purge.

**Rien n'a été vérifié sur iPhone ni dans Safari.** En particulier, l'agent n'a pas pu vérifier :

- le comportement de la caméra dans une PWA iOS installée ;
- la proposition de la photothèque ;
- la purge réelle après 7 jours ;
- la persistance après fermeture forcée ;
- la précision de la position ;
- l'installation sur l'écran d'accueil ;
- le rendu sur petit écran.

Les icônes sont des carrés gris provisoires, sans couleur de thème : la vraie identité visuelle viendra avec la marque (US-028, US-048). L'envoi est simulé, car aucun serveur ne reçoit encore les photos (US-302).

## 8. Règle de décision pour ADR-005 (la décision vous appartient, fin du lot 0)

On regarde les résultats des **iPhone A, B et C en app installée** :

1. **Si C1 échoue sur un seul iPhone cible** : la PWA ne garantit pas la preuve photo. Il faut un **repli pour le comptoir seulement** :
   - **enveloppe native** si les agences gardent leurs propres iPhone. Coût : comptes développeur Apple et Google, revue Apple, délai de publication à ajouter au planning ;
   - **terminal Android fourni** si l'appareil D réussit C1 à C8, si le nombre de comptoirs est faible et si l'on veut éviter l'App Store. Coût : achat des appareils et logistique.
2. **Si C1 réussit partout mais que C3, C4, C6 ou C8 échouent** : **PWA seule pour la Bêta pilote**. C'est déjà le mode prévu : en ligne, sur le Wi-Fi du comptoir (TRP-057 en Bêta : MANUEL). Le choix est reporté au mode hors ligne du P0-A : accepter « comptoir en ligne seulement », ou appliquer le repli du point 1.
3. **Si C1, C3, C4, C6 et C8 réussissent sur A, B et C** : **PWA seule**, sans repli.
4. C2, C5, C7 et C9 ne déclenchent **jamais seuls** un repli. On les note et on les corrige en développement, ou on les accepte.

Chaque critère iOS en échec (caméra, stockage, installation) est inscrit au registre des risques (P-04, `docs/team/RISKS.md`) avec la recommandation de repli, et présenté au point hebdomadaire de fin de lot 0 (19 US-026). La décision est consignée dans `docs/team/DECISIONS.md` et reportée sur ADR-005. Tant qu'elle n'est pas prise, le défaut reste : **PWA en ligne en Bêta** (ADR-039).
