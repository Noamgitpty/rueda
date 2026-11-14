# packages/design-tokens — jetons de design (`@rueda/design-tokens`)

Livré par **US-030** (lot 0, DSN-002), complété par **US-031** (règles de mouvement et règles photo, voir plus bas). C'est la **source unique du thème** : couleurs, polices, tailles, espacements, rayons, ombres, verre, mouvement, avatars et motif _camino_ viennent d'ici. Aucun composant ne contient de valeur de style en dur ; le lint le vérifie (voir plus bas). Décisions : ADR-036 (thème piloté par les données) et ADR-047 (ce paquet).

Point d'entrée unique : `src/index.ts` (`import { … } from '@rueda/design-tokens'`).

## Responsabilité

Source unique du thème : lire les palettes, les valider, contrôler le contraste et produire la feuille de variables CSS ; refuser au lint tout style codé en dur dans `apps/` et `packages/`.

## Entités

Aucune entité persistée : les palettes sont des fichiers JSON du dépôt (`docs/design/US-028/`) ; la version publiée en base arrive avec US-034 (voir « Limites connues »).

## Événements

Aucun événement de domaine : le paquet est une bibliothèque pure, appelée au rendu, sans état ni effet de bord.

## Ports

Aucun port : aucune dépendance externe. Le thème actif se lit dans l'environnement (`getActiveTheme(process.env)`).

## Changer de palette en 1 étape

L'étape : choisir l'identifiant de la palette. Ce qui suit dépend de l'endroit où l'on est.

| Où                               | Comment                                                                                          | Effet                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Développement (`next dev`)       | remplacer `"palette"` dans `packages/design-tokens/config/theme.json`                            | au rechargement de la page                                           |
| Production, sans reconstruire    | définir `THEME_PALETTE=<id>` (et au besoin `THEME_COLOR_SCHEME`) dans l'environnement du serveur | au **redémarrage** du serveur (la variable est lue à chaque requête) |
| Production, par le dépôt         | modifier `config/theme.json` ou un fichier de palette, puis reconstruire                         | au **déploiement** : la configuration et les palettes sont compilées |
| Plus tard, par le fondateur seul | publier une version de marque depuis le back-office (US-034, US-120)                             | au rechargement, sans déploiement                                    |

Les palettes et `config/theme.json` sont importés en JSON, donc **compilés** dans le serveur Next : en production, modifier un fichier sans reconstruire n'a aucun effet. Les lire à l'exécution (système de fichiers) a été écarté : le chemin vers `docs/design/` n'existe plus une fois l'application construite et tracée, et la vraie source « sans déploiement » sera la base (US-034).

```json
{ "palette": "lienzo-grafito", "colorScheme": "auto" }
```

| Identifiant      | Direction (docs/design/US-028)                              | État au chargement                                     |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| `lienzo-tinta`   | Lienzo · Tinta, **défaut** (choix du fondateur, 2026-11-02) | acceptée                                               |
| `lienzo-grafito` | Lienzo · Grafito                                            | acceptée                                               |
| `marina`         | Marina                                                      | acceptée                                               |
| `lienzo-azur`    | Lienzo · Azur                                               | **refusée** : lien `primary` sur verre 3,89:1 (clair)  |
| `cielo`          | Cielo                                                       | **refusée** : lien `primary` sur verre 4,05:1 (clair)  |
| `lagune`         | Lagune                                                      | **refusée** : lien `primary` sur verre 4,08:1 (clair)  |
| `voltio`         | Voltio                                                      | **refusée** : 3,80:1 (clair) et 3,85:1 (sombre)        |
| `senal`, `istmo` | directions du 31 octobre, écartées, conservées              | acceptées                                              |
| `tierra-firme`   | direction du 31 octobre, écartée                            | **refusée** : lien `primary` sur verre 4,32:1 (sombre) |

Une palette refusée ne se charge pas (le rendu échoue, fail-closed). Pour la rendre utilisable, foncer son `primary` clair (ou éclaircir le sombre) dans son fichier jusqu'à passer 4,5:1 sur le verre au pire cas ; `listPalettes()` donne l'état et les paires en échec.

`colorScheme` (ou `THEME_COLOR_SCHEME`) vaut `auto` (clair ou sombre selon l'appareil), `light` ou `dark`. Une palette ou un mode inconnu fait échouer le rendu : on ne retombe jamais en silence sur un autre thème.

- **Retoucher une palette** : modifier son fichier `docs/design/US-028/tokens-<id>.json` (et sa `meta.version`). Le contrôle de contraste s'applique au prochain chargement.
- **Design neuf** : déposer `docs/design/US-028/tokens-<id>.json` (même structure que Tinta, `meta.direction` = `<id>`), l'ajouter au registre `src/palettes.ts` (une ligne ; le test du registre échoue tant qu'il manque), puis le choisir comme ci-dessus.
- **Plus tard (US-034, US-120)** : `loadTheme(id, surcharges)` accepte déjà des jetons partiels au même format, validés et contrôlés de la même façon.

## Ce que fait le paquet

| Étape       | Détail                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecture     | `src/palettes.ts` importe **directement** les dix fichiers `docs/design/US-028/tokens-*.json` (aucune copie).                                                                                                                                                                                                                                                                 |
| Socle       | `foundation.tokens.json` complète chaque palette des jetons ajoutés par US-030 (avatars, titre d'affichage, `radius.card`, `shadow.card` / `float`, verre, durées longues, _camino_, anneau de focus) par des **alias** vers ses propres jetons ; une palette peut les redéfinir (Tinta le fait).                                                                             |
| Validation  | `buildTheme` : alias `{chemin}` résolus (cycles et alias morts refusés), chaque valeur contrôlée selon son `$type` (`color` en `#RRGGBB`, `dimension`, `duration`, `cubicBezier`, `fontFamily`, `fontWeight`, `number`, ombres), jetons requis présents en clair et en sombre. Une valeur ne peut contenir ni `;`, ni accolade, ni `<`.                                       |
| Contraste   | `checkContrast` : paires de `CONTRAST_RULES` (texte ≥ 4,5:1, composants et focus ≥ 3:1) en clair et en sombre, plus le texte sur le verre au **pire cas** (UX-49). `loadTheme` refuse le thème et nomme chaque paire en échec (`ThemeContrastError`).                                                                                                                         |
| CSS         | `themeStyleSheet` : variables à la racine, sombre par `prefers-color-scheme` ou `data-theme="dark"`, durées à `0s` avec `prefers-reduced-motion`, verre opaque avec `prefers-reduced-transparency` ou sans `backdrop-filter`, et règles de base (`BASE_CSS`) qui ne lisent que des variables.                                                                                 |
| Aperçu      | `previewStyleSheet(theme, 'data-…')` (US-120, ADR-116) : mêmes variables, portées par `[data-…="light"]` et `[data-…="dark"]` au lieu de `:root` ; sert à l'aperçu d'un brouillon dans le back-office sans toucher le thème de la page.                                                                                                                                       |
| Logo        | `logoProblem` / `logoProblems` (US-120 ; liste blanche US-122, ADR-122) : logo SVG des jetons `brand.logo*` borné à 20 000 caractères, lu par une analyse XML stricte avec liste blanche d'éléments et d'attributs (aucun préfixe d'espace de noms, aucun `on…`, aucune entité ni déclaration, aucun échappement CSS, `url()` vers `#id` seulement) ; refusé, jamais nettoyé. |
| Thème actif | `getActiveTheme(process.env)` : appelé à chaque rendu par `apps/web/theme.tsx` et `apps/backoffice/theme.tsx`, qui injectent la feuille dans `<head>`.                                                                                                                                                                                                                        |

## Variables CSS disponibles

Toutes les palettes produisent **les mêmes noms** (un test le vérifie) : un composant écrit contre ces noms fonctionne avec n'importe quelle palette.

| Famille           | Variables                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Couleurs          | `--color-primary`, `--color-on-primary`, `--color-surface`, `--color-surface-raised`, `--color-surface-sunken`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-border-strong`, `--color-accent`, `--color-on-accent`, `--color-success(-soft)`, `--color-danger(-soft)`, `--color-warning(-soft)`, `--color-focus`, `--color-avatar-1…4`, `--color-on-avatar-1…4` |
| Typographie       | `--font-family-heading`, `--font-family-body`, `--font-family-mono`, `--font-weight-heading` / `body` / `strong`, `--font-size-xs…3xl`, `--font-line-height-body` / `heading`, `--font-display-family` / `weight` / `size` / `size-compact` / `letter-spacing` / `line-height`                                                                                                      |
| Espace et tailles | `--space-1…10`, `--size-touch-target`, `--size-action-bar`, `--size-focus-ring`, `--size-focus-offset`                                                                                                                                                                                                                                                                              |
| Formes            | `--radius-sm` / `md` / `lg` / `card` / `pill`, `--shadow-raised` / `card` / `float`                                                                                                                                                                                                                                                                                                 |
| Verre             | `--glass-bg`, `--glass-backdrop` (avec repli opaque), `--glass-opacity`, `--glass-blur`, `--glass-saturate`                                                                                                                                                                                                                                                                         |
| Mouvement         | `--motion-duration-fast` / `base` / `slow` / `enter` / `page` / `signature` / `skeleton` / `stagger`, `--motion-easing-standard` / `emphasis` / `exit`, `--motion-iterations-skeleton`, `--motion-scale-press`                                                                                                                                                                      |
| _Camino_          | `--camino-stroke-width`, `--camino-dash-array` (couleur : `--color-focus`)                                                                                                                                                                                                                                                                                                          |

Règles d'usage (10b UX-49, UX-67 à UX-69) : `--color-border` n'est jamais seul contour d'un composant interactif (`--color-border-strong`) ; `--color-accent` ne porte jamais seul un état ; sur le verre, `--color-text`, `--color-text-muted` et `--color-primary` (liens) sont contrôlés en texte au pire cas, pour toutes les palettes ; `--motion-duration-signature` ne sert qu'au tracé du _camino_ et au compteur de revenus.

## Règles de mouvement et règles photo (US-031, ADR-069)

Document : [`docs/design/US-031/README.md`](../../docs/design/US-031/README.md). Données dans `rules/`, validées au chargement (fail-closed) :

| Fichier                     | Export                                                                                                                                  | Contenu                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules/motion.rules.json`   | `MOTION_RULES`, `motionPattern(id)`, `motionDurationMs(theme, id, reduced)`, `prefersReducedMotion(matchMedia)`, `REDUCED_MOTION_QUERY` | 12 micro-interactions, chacune avec ses jetons de durée et de courbe ; budget (un mouvement à la fois, 6 cartes décalées au plus, aucune boucle)         |
| `rules/photo.rules.json`    | `PHOTO_RULES`, `checkHandoverSet(slotCodes)`, `TRP004_MINIMUM`, `LISTING_MINIMUM_FLOOR`                                                 | prise de vue (paysage 4:3, ≥ 1 600 × 1 200), cadrages, lumière, interdits, 29 angles, annonce (6 obligatoires, 10 recommandées), remise (25 `slot_code`) |
| `rules/photo.messages.json` | `PHOTO_MESSAGES`                                                                                                                        | 95 textes `web.photo.*` en es, en, fr, pt (pt-BR) (format de `@rueda/i18n`, à y verser : ADR-069 point 7)                                                |

- **Changer une micro-interaction** : modifier son motif dans `motion.rules.json` (jamais une valeur : un chemin de jeton). Changer une durée : modifier le jeton (palette ou `foundation.tokens.json`).
- **Changer une règle photo** : modifier `photo.rules.json` et, si un texte change, ses **quatre** langues (es, en, fr, pt-BR) dans `photo.messages.json`. Les planchers de 16 TRP-004 (15 / 8 / 2) et de 08 BR-LIST-05 (6) ne peuvent pas être abaissés par les données.
- **Mouvement réduit** : la feuille du thème met les durées à `0s` et `--motion-scale-press` à `1` ; `BASE_CSS` coupe animations et transitions ; le lint (ci-dessous) exige l'arrêt explicite de toute animation CSS.

## Lint des styles codés en dur

`pnpm lint` exécute `node packages/design-tokens/lint/cli.ts` (aussi `pnpm lint:style`). Il parcourt **tout** `apps/` et `packages/` : composants, tests, fichiers de configuration (`*.config.ts`), fichiers statiques. Extensions : `.css`, `.scss`, `.sass`, `.less`, `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.html`, `.svg`. Seuls sont ignorés `node_modules` et les sorties de construction **à la racine** d'une application ou d'un paquet (`.next`, `.turbo`, `dist`, `coverage`, `out`) : un `app/public/` ou un `app/out/` imbriqué est analysé.

Il refuse : couleur hexadécimale, fonction de couleur ou dégradé (`rgb`, `hsl`, `oklch`, `linear-gradient`…), couleur nommée ou système (dans toute propriété, `text-decoration`, `column-rule`, `-webkit-text-fill-color` compris), police (y compris le raccourci `font`), taille de texte, graisse, espacement (toutes unités, `%` compris), rayon, ombre ou filtre, durée. Il juge aussi :

- le **repli** d'un `var(--x, repli)`, comme une valeur écrite en dur ;
- les **variables locales** `--x` : elles ne peuvent contenir que des `var()`, des nombres sans unité et des mots neutres (`calc`, `color-mix`, `in`, `srgb`…) ;
- les propriétés **sans tenir compte de la casse** (`COLOR:RED`) ;
- en TSX : les clés de style nues ou **entre guillemets** (camelCase ou kebab-case), l'attribut **`style="…"`**, les attributs de couleur (`fill`, `stroke`, `stopColor`…), et le **CSS écrit dans une chaîne ou un gabarit** (`` `.a{color:red}` ``, `<style>{…}</style>`) ;
- en HTML et SVG : attributs et blocs `<style>`.

**Mouvement réduit** (US-031, `lint/motion.ts`, même commande, règle `reduced-motion`) : une `animation` (ou `animation-name`) CSS doit être remise à `none` dans un bloc `@media (prefers-reduced-motion: reduce)` du même fichier, pour chacun de ses sélecteurs (sauf si elle n'est déclarée que sous `no-preference`) ; un script qui appelle `requestAnimationFrame` ou `.animate(` doit consulter la préférence (`prefersReducedMotion`, `motionDurationMs`, `REDUCED_MOTION_QUERY` ou la media query) ; `<animate>` et apparentés (SMIL) sont refusés dans le HTML et le SVG. Limite : du CSS d'animation écrit dans une chaîne TS n'est pas suivi.

Permis : `var(--…)` sans repli, `calc()` et `color-mix()` de variables, `0`, `auto`, `none`, `inherit`, `currentColor`, `transparent`, `50%` pour un rayon. **Seule exemption**, explicite dans `lint/tree.ts` (`EXEMPT_PATHS`, une raison par entrée) : `packages/design-tokens/src/`, `lint/` et `test/`, qui définissent ou décrivent les valeurs. Il n'y a pas de liste blanche de valeurs : un faux positif se corrige dans `lint/scan.ts`, avec une revue design. Limite connue : une clé calculée (`{ [prop]: 'red' }`) n'est pas jugée. `test/lint.test.ts` contient un test par contournement relevé par la revue et une preuve par mutation sur des copies de `home.module.css` et `home-content.tsx`.

## Commandes de test

`pnpm --filter @rueda/design-tokens test:unit` : mouvement réduit sur les composants animés **réels** de `packages/ui` (cascade rejouée pour chaque palette acceptée, `BASE_CSS`, lint, mutation : `reduced-motion.test.ts`), catalogue de mouvement et lint du mouvement (`motion.test.ts`), règles photo contre les valeurs de 08, 16 et 17 et refus des données fautives (`photo.test.ts`), formule WCAG (valeurs de référence publiées, et **oracle indépendant** : chaque ratio consigné par US-028 dans `contrastChecks` de chaque palette est retrouvé à 0,01 près), registre complet, palettes valides et conformes, mêmes variables partout, valeurs Tinta de 10b UX-67, refus de contraste (clair, sombre, composant, avatar, verre), refus de format (injection CSS, type inconnu, jeton absent, alias), surcharges publiées, feuille générée, sélection et fail-closed, lint. Les entrées de cache turbo incluent `docs/design/US-028/tokens-*.json` et `apps/**` (`turbo.json` du paquet).

## Limites connues

- Les **fichiers de police** (Bricolage Grotesque, Manrope, OFL) ne sont pas encore servis : le rendu retombe sur `system-ui`. À héberger nous-mêmes (pas d'appel à Google Fonts depuis le navigateur), avec la bibliothèque de composants (US-032).
- La **version publiée en base** (`brand_version.tokens`, 17 §3.2.13) arrive avec US-034 ; d'ici là, la source est la configuration du dépôt et l'environnement.
- Le **nom de marque** (`brand.name` = Kmino dans les palettes) n'est pas encore lu par les applications (`BRAND_NAME` reste `{brand_name}`) : US-034.
