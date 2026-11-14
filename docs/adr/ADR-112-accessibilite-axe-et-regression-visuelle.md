# ADR-112 — Balayage axe de chaque écran et régression visuelle par captures Playwright

- **Statut** : PROPOSÉ (US-044, agent QA, claude-opus-5-5, 2026-11-12). Revues exigées : code, UX, QA ; sécurité (`.github/workflows/ci.yml`). À reporter dans 17 §8.1.
- **Sources** : 19 US-044 et §1.8 (« 0 violation axe bloquante », régression visuelle) ; 10b §3.10 (UX-46 à UX-49) ; ADR-074 (harnais e2e) ; ADR-055 (bibliothèque de composants, polices non hébergées).

## Contexte

axe-core tournait dans six parcours e2e, chacun avec sa copie de la fonction, sur `main` seulement et en clair seulement : la coquille (en-tête, choix de la langue) et plusieurs écrans n'étaient jamais analysés, et le contraste n'était mesuré que sur les paires de jetons (jsdom ne calcule pas le contraste rendu). Aucune régression visuelle n'existait. La console interne (`apps/backoffice`) n'avait aucun test dans un navigateur.

## Décision

1. **Une seule implémentation d'axe** (`apps/web/e2e/axe.ts`) : règles WCAG 2.0 / 2.1 / 2.2, niveaux A et AA ; toute violation est bloquante. Les parcours des stories l'importent au lieu de la recopier.
2. **Balayage systématique** : `screens.spec.ts` (chaque écran du site, liste `SCREENS`, état d'arrivée) et `console.spec.ts` (chaque état d'accès de la console et la console elle-même). Page entière, coquille comprise ; quatre langues ; clair puis sombre (`emulateMedia`, le thème suit l'appareil) ; 360 et 390 px ; tablette en es et en. Plus « mobile d'abord » (aucun défilement horizontal, cibles ≥ 44 px).
3. **Console sans API** : le back-office est démarré par Playwright sans `RUEDA_API_URL` (aucun mandataire) ; le test intercepte `/api/**` dans le navigateur et répond des corps fixes et fictifs. Le contrat réel reste prouvé par les tests de l'API.
4. **Régression visuelle native** : `toHaveScreenshot` de Playwright, pleine page, à l'échelle CSS ; références **dans le dépôt** (`apps/web/e2e/__screenshots__/linux/<projet>/<écran>/<langue>-<thème>.png`). Aucun service ni compte externe. Seuil par pixel 0,1, aucune tolérance en nombre de pixels.
5. **Matrice des captures (PROPOSÉ)** : à 360 px, les quatre langues en clair et l'espagnol en sombre ; en tablette, es et en en clair. axe, lui, tourne dans toute la matrice. Raison : poids du dépôt (une capture pèse 20 à 400 Ko, et un changement de jeton les réécrit toutes).
6. **Stabilité** : horloge du navigateur figée, fuseau UTC, mouvement réduit, animations et curseur coupés, données du double ou des routes interceptées, polices du système ; **image du runner épinglée** (`ubuntu-24.04`) pour le job `e2e-web`. Les références qui font foi sont celles du runner Linux ; celles d'un poste local (`win32/`, `darwin/`) sont ignorées par git.
7. **Approbation au lieu d'un échec muet** : en CI, aucune référence n'est jamais écrite (`updateSnapshots: 'none'`). Un écart ou une capture absente fait échouer le job ; une étape « échec seulement » rejoue les tests en échec en écrivant les captures obtenues, et l'artefact `regression-visuelle` porte l'attendu, l'obtenu, la différence et les références proposées. Approuver = commiter les références proposées : GitHub montre le diff d'image dans la demande de fusion, relu par la revue UX. Procédure : `docs/qa/REGRESSION_VISUELLE.md`.
8. **CI** : même job `e2e-web` (aucun nouveau statut requis) ; il construit aussi `@rueda/backoffice`.

## Conséquences

- Un nouvel écran s'ajoute à `SCREENS` (site) ou `SCREENS` de `console.spec.ts` ; sa première capture arrive par l'artefact de la CI.
- Un changement de jetons (US-030) ou de mise en page passe forcément par une approbation d'images.
- Une mise à jour du Chrome du runner peut déplacer quelques pixels : même procédure (artefact, relecture, commit).
- Constat corrigé par cette story : le bouton du choix de langue avait un nom accessible qui ne contenait pas le code affiché (WCAG 2.5.3) ; il porte désormais le code visible puis le libellé complet en texte réservé aux lecteurs d'écran.
- Hors périmètre : les états profonds de chaque écran (erreurs, étapes) restent dans les parcours de leur story ; le prototype `/proto` et le laboratoire `/lab` ne sont pas des écrans du produit ; TalkBack et VoiceOver restent manuels (UX-46).

## Alternatives écartées

- **Percy, Chromatic, Applitools** : service payant ou compte externe (interdit).
- **Storybook + test-runner** : la bibliothèque n'a pas de Storybook (sa vitrine est `/ui`, ADR-055) ; la vitrine est balayée comme un écran.
- **Comparer à `main` à chaque PR (deux builds)** : double le temps du job et ne garde pas d'historique approuvé.
- **Tolérance en nombre de pixels** : masquerait un petit changement de jeton (anneau de focus, filet).
- **Captures dans les quatre langues en sombre et à 390 px** : environ trois fois plus d'images pour peu de défauts en plus ; axe couvre déjà le contraste de chaque combinaison.
