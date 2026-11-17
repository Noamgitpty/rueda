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

## Capture sans calques composés (`stableCompositing`)

Un écran de `SCREENS` marqué `stableCompositing: true` est capturé sous la feuille `apps/web/e2e/capture-sans-calques.css`, que Playwright n'applique **que pendant la capture** (option `stylePath` de `toHaveScreenshot`, `e2e/visual.ts`) : le site ne la sert jamais et le balayage axe voit la page réelle. Elle neutralise ce qui crée des calques composés (`backdrop-filter`, `isolation`, `will-change`).

- Pourquoi : sur l'accueil (S01), la pastille en verre (`backdrop-filter`) dans le bloc « nuit » (`isolation`, `overflow: hidden`, coins arrondis) fait tramer le texte de deux façons selon le minutage du compositeur de Chrome : même texte, même mise en page, mêmes couleurs, mais un anticrénelage du texte normal différent d'une exécution à l'autre (échec au hasard de `accueil · es`, run 43684357457, PR #163). Le seuil reste inchangé.
- Effet visible : nul ou négligeable (le flou s'applique sur un aplat). Toute référence d'un écran marqué est prise sous la feuille, depuis l'artefact de la CI comme les autres.
- Ne pas s'en servir pour masquer un écart réel : un écran n'est marqué qu'après un diagnostic d'instabilité de tramage (attendu, obtenu et différence relus), consigné dans sa passation.

## Texte sans anticrénelage sous-pixel (`--disable-lcd-text`)

Le Chrome des e2e est lancé avec `--disable-lcd-text` (`playwright.config.ts`, `use.launchOptions`) : tout le texte est tramé en niveaux de gris. Le site servi ne change pas.

- Piège : Chrome choisit l'anticrénelage sous-pixel (LCD, franges colorées autour des lettres) ou en niveaux de gris **selon les calques composés** de la page, et le tramage LCD **varie d'une machine de la CI à l'autre** (même texte, mêmes positions, environ 5 % d'encre en plus ou en moins sur le texte normal, le gras intact). La capture est alors stable dans un run, rejouée à l'identique, mais différente au run suivant.
- Cas d'US-201 (PR #163, après #168) : la feuille `capture-sans-calques.css` retire aussi le `backdrop-filter` de l'en-tête collant de la coquille, qui maintenait toutes les pages en niveaux de gris ; l'accueil capturé sous la feuille passait en LCD et `accueil · en` échouait d'un run à l'autre (run 43766552112, 4 452 pixels). Reproduit en local : la feuille fait passer en LCD l'accueil et l'inscription ; avec `--disable-lcd-text`, les captures sans feuille restent identiques au pixel près et celles sous la feuille repassent en niveaux de gris.
- Diagnostic : agrandir attendu et obtenu dans la zone du diff ; des franges colorées sur le texte normal d'un seul des deux, ou de densité différente, signalent ce piège, pas un écart réel.

## Ajustement des glyphes selon l'échelle de l'écran (`--force-device-scale-factor=2`)

Les projets téléphone (`mobile-360`, `mobile-390`, `console-*`, `pwa`) lancent Chrome avec `--force-device-scale-factor=2`, égal à leur `deviceScaleFactor` émulé (`playwright.config.ts`, objet `phone`). La tablette (échelle 1) n'en a pas besoin. Le site servi ne change pas.

- Cause (N-180, N-193 ; runs 43852927038 `accueil · es`, 43888473049 `checkout-assureur-ferme · en`, 44029156330 `accueil · pt`, 44036709674 `accueil · en`) : sous Linux, `gfx::GetFontRenderParams` (`ui/gfx/font_render_params_linux.cc`) règle le tramage d'une police selon l'échelle de la requête : à 1, ajustement des glyphes à la grille de pixels de fontconfig (hinting « slight ») ; au-dessus de 1, positionnement sous-pixel et **aucun** ajustement. Sans le drapeau, l'écran de Chrome vaut 1 et l'émulation 2. La première police de la page (le texte courant, 16 px, graisse normale) est parfois demandée avant que l'échelle émulée n'atteigne le moteur de rendu (course qui se gagne autrement sous la charge de la CI) ; elle garde alors l'ajustement pour toute la page, les polices créées ensuite (gras, 14 px) non.
- Signature dans les artefacts : seul le texte courant de 16 px diffère, partout sur la page (bloc « nuit », listes, cartes, valeurs des `select`), dans les deux thèmes du même test ; mêmes positions horizontales, contours décalés verticalement d'environ un demi-pixel, encre ±5 % ; gras, titres et texte de 14 px identiques au pixel près ; aucune frange de couleur. Le rejeu du même test seul, sur la même machine, passe. Le sens de l'écart varie d'un écran à l'autre : chaque référence a été prise dans l'un ou l'autre état.
- Correctif : écran et émulation à la même échelle, la course n'a plus d'enjeu. Seuils, relances et masques inchangés.
- **Reprise unique des références** : l'état majoritaire des anciennes références mêlait les deux réglages (texte courant 16 px ajusté, le reste non) ; le correctif change donc toutes les captures de `mobile-360` (245) et de `console-360` (35), la tablette restant identique au pixel près (98). `--disable-font-subpixel-positioning`, essayé au run 44046521182, changeait aussi la tablette : écarté. La suite complète avec 224 écarts dépassant les 20 minutes du job, les références ont été produites par deux commits **temporaires**, annulés dans le commit de reprise (captures de `mobile-360` et `console-360` seules, délai de capture réduit ; run 44053808920), puis relues : même contenu, mêmes couleurs ; texte courant sans ajustement, flèche native des `select` plus fine, hauteur de page de -1 à -5 px sur quelques écrans (`fiche-*`, `hote-verification`, `vitrine-composants`, `recherche-resultats · fr` +1) par les métriques non arrondies des polices sans ajustement. Le diff final de `playwright.config.ts` et `e2e/visual.ts` ne contient que le drapeau.
- Le diagnostic « LCD » d'US-201 (texte normal ±5 %, gras intact) avait probablement la même cause ; `--disable-lcd-text` reste utile (aucune frange de couleur dépendant des calques).

## Rejouer en local

```bash
pnpm turbo run build --filter=@rueda/web --filter=@rueda/backoffice
pnpm --filter @rueda/web exec playwright test screens console --project mobile-360 --project console-360
```

Hors CI, les captures absentes sont écrites dans `e2e/__screenshots__/win32/` (ou `darwin/`), ignorées par git : utiles pour regarder un rendu, jamais des références.
