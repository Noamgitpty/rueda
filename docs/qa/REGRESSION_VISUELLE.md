# Accessibilité automatisée et régression visuelle (US-044, ADR-112)

## Ce qui tourne à chaque PR (job `e2e-web`)

| Fichier                            | Projets                                         | Contrôles                                                                                          |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/web/e2e/screens.spec.ts`     | `mobile-360`, `mobile-390`, `tablette` (es, en) | chaque écran du site (`SCREENS`) : axe page entière en clair et en sombre, mobile d'abord, capture |
| `apps/web/e2e/console.spec.ts`     | `console-360`, `console-390`                    | chaque état de la console interne : mêmes contrôles                                                |
| parcours des stories (`*.spec.ts`) | selon la story                                  | `expectAccessible` (`e2e/axe.ts`) à chaque état profond                                            |

- axe : WCAG 2.0 / 2.1 / 2.2, niveaux A et AA ; **toute** violation est bloquante.
- Captures (matrice PROPOSÉE) : 360 px, quatre langues en clair et es en sombre ; tablette, es et en en clair. Références : `apps/web/e2e/__screenshots__/linux/<projet>/<écran>/<langue>-<thème>.png`.

## Ajouter un écran

1. Ajouter une ligne à `SCREENS` (`screens.spec.ts`, ou `console.spec.ts` avec les réponses de `/api`).
2. Pousser : le job échoue (« capture absente ») et publie l'artefact `regression-visuelle`.
3. Relire les images proposées, puis les commiter (voir ci-dessous).

## Approuver un écart (changement de jetons, de mise en page, de texte, de Chrome)

1. Le job `e2e-web` est rouge ; le résumé liste les écrans en écart.
2. Télécharger l'artefact `regression-visuelle` de l'exécution : `ecarts/` (copie de `test-results/` faite avant le rejeu) contient pour chaque écart `*-expected.png`, `*-actual.png` et `*-diff.png` ; `e2e/__screenshots__/linux/` contient les références proposées, aux bons chemins.
3. Si l'écart est voulu : copier les références proposées dans `apps/web/e2e/__screenshots__/linux/` et les commiter avec la story. La demande de fusion montre le diff de chaque image ; la revue UX les approuve. Si l'écart n'est pas voulu : corriger le code.
4. Jamais : écrire les références depuis un poste Windows ou macOS (polices différentes), relâcher le seuil, ou retirer un écran de la liste pour faire passer la CI.

## Rejouer en local

```bash
pnpm turbo run build --filter=@rueda/web --filter=@rueda/backoffice
pnpm --filter @rueda/web exec playwright test screens console --project mobile-360 --project console-360
```

Hors CI, les captures absentes sont écrites dans `e2e/__screenshots__/win32/` (ou `darwin/`), ignorées par git : utiles pour regarder un rendu, jamais des références.
