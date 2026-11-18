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
- **Retour malgré le drapeau** (run 44071319010, commit de fusion c5d87037, `accueil · fr` en `mobile-360`, 2 474 px) : même signature, relue dans l'artefact `regression-visuelle` (texte courant de 16 px seul, chapeau, valeurs des `select`, listes ; titres et gras identiques ; mêmes positions horizontales ; centre d'encre du chapeau décalé de 0,045 px vers le bas, encre +0,35 %). Ni police web manquante (« fonts loaded » au journal de la capture), ni image, ni animation, ni contenu : aucun autre écart. L'échelle de l'écran ne ferme donc pas toute la course. Les téléphones demandent aussi `--font-render-hinting=none`, qui fixe l'ajustement à « aucun » quelle que soit l'échelle de la requête : c'est l'état que l'échelle 2 donne déjà, les références restent inchangées et seule la branche « ajustée » disparaît. Efficacité à confirmer dans la durée : la course est rare (une capture sur plusieurs milliers), deux runs verts ne la prouvent pas ; tout nouvel écart de même signature invalide ce correctif.
- Le diagnostic « LCD » d'US-201 (texte normal ±5 %, gras intact) avait probablement la même cause ; `--disable-lcd-text` reste utile (aucune frange de couleur dépendant des calques).

## Polices créées avant la première mise en page (`capture-polices.css`)

Les captures des projets téléphone (`deviceScaleFactor` 2 : `mobile-360`, `console-360`) appliquent, pendant la capture seulement, la feuille `e2e/capture-polices.css` (`text-rendering: geometricPrecision`), par `captureStyles` dans `e2e/visual.ts`. La tablette (échelle 1) ne la reçoit pas. Le site servi et le balayage axe ne changent pas.

- **Retour malgré les deux drapeaux** (PR #219, qui ne touche pas `apps/web` : run 44171328704, `accueil · es` en clair, 1 711 px, et en sombre, 1 618 px ; run 44138991977, `accueil · fr`) : même signature que ci-dessus, relue dans les artefacts. Seul le texte courant de 16 px en graisse normale diffère (chapeau, valeurs des `select`, étapes, bloc hôte) ; les titres, le gras, les libellés de 14 px et les positions horizontales sont identiques (centre d'encre horizontal à 0,1 px près) ; chaque ligne est décalée verticalement de 0,1 à 0,7 px, avec une encre à −3 %. Aucune image, aucune animation ni aucun contenu ne diffère, et la hauteur de page est la même.
- **Cause** (source de Chromium) : sous Linux, `FontPlatformData` demande le réglage de tramage d'une police avec `FontCache::DeviceScaleFactor()` (`QuerySystemRenderStyle`, `font_platform_data.cc`). Cette valeur est **globale au processus de rendu** : elle vaut 1 au départ et seul `LayoutView::LayoutRoot()` la met à jour (`layout_view.cc`). À l'échelle 1, la police reçoit l'ajustement de fontconfig, sans positionnement sous-pixel ; à l'échelle 2, elle reçoit le positionnement sous-pixel, sans ajustement. Une police demandée par le calcul de style **avant** la première mise en page du processus est créée à l'échelle 1 : c'est le cas du texte de 16 px de l'accueil, que l'unité `ch` du chapeau (`max-inline-size: 34ch`) fait résoudre au calcul du style. Sa liste de polices reste ensuite en cache dans le document (`FontFallbackMap`), alors que les polices demandées plus tard (gras, 14 px) sont créées à l'échelle 2. Si le processus a déjà fait une mise en page, par exemple quand Chrome réutilise un processus sous la charge de la CI, tout est créé à l'échelle 2. Les drapeaux `--force-device-scale-factor=2` et `--font-render-hinting=none` ne changent pas cette valeur : la course reste ouverte.
- **Preuves** (run 44177170912, preuve temporaire `preuve-polices.spec.ts`, retirée depuis ; outils dans le scratchpad de l'agent) :
  - Une page entièrement mise en page à l'échelle 1, puis passée à 2 par `Emulation.setDeviceMetricsOverride`, s'écarte de la référence ; l'état est reproduit à coup sûr.
  - L'accueil dont les listes de polices sont invalidées avant la capture (`document.fonts.add` puis `delete`, ce qui les recrée à l'échelle courante) est **identique au pixel près** aux « obtenus » des échecs 44171328704 (es clair) et 44138991977 (fr clair).
  - Conclusion : les anciennes références de l'accueil fixaient l'état « 16 px à l'échelle 1 », que l'unité `ch` rend majoritaire, et les échecs montraient le rendu à l'échelle 2.
  - La simple invalidation a été écartée : au même run, onze captures `es-dark` (fiches, recherche, A10, S04) en changeaient, et un second passage leur rendait leur état d'avant. Ce n'est pas déterministe.
- **Correctif** : `text-rendering: geometricPrecision` impose le positionnement sous-pixel sans ajustement **quelle que soit l'échelle de la requête** (`QuerySystemRenderStyle`). C'est le réglage que l'échelle 2 donne déjà. Une nouvelle description de police (le mode de rendu fait partie de la clé du cache) fait recréer les polices au moment de la capture, et le résultat ne dépend plus ni du minutage ni du processus.
  - Run 44182379316 : toutes les captures des téléphones restent identiques, sauf les cinq de l'accueil (`mobile-360`, es clair et sombre, en, fr, pt). Leurs nouvelles références, reprises de l'artefact de ce run, sont identiques au pixel près aux « obtenus » des échecs.
  - La preuve « page créée à l'échelle 1 » capturée sous la feuille donne exactement la nouvelle référence `es-light`.
  - Seuils, `retries: 0` et masques sont inchangés.
- Diagnostic d'un nouvel écart de cette signature : vérifier que la capture passe par `expectScreen`, seule à appliquer la feuille.

## Rejouer en local

```bash
pnpm turbo run build --filter=@rueda/web --filter=@rueda/backoffice
pnpm --filter @rueda/web exec playwright test screens console --project mobile-360 --project console-360
```

Hors CI, les captures absentes sont écrites dans `e2e/__screenshots__/win32/` (ou `darwin/`), ignorées par git : utiles pour regarder un rendu, jamais des références.
