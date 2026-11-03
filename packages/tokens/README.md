# packages/tokens — jetons de design (`@rueda/tokens`)

Livré par **US-030** (lot 0, DSN-002). C'est la **source unique du thème** : couleurs, polices, tailles, espacements, rayons, ombres, verre, mouvement, avatars et motif _camino_ viennent d'ici. Aucun composant ne contient de valeur de style en dur ; le lint le vérifie (voir plus bas). Décisions : ADR-036 (thème piloté par les données) et ADR-047 (ce paquet).

Point d'entrée unique : `src/index.ts` (`import { … } from '@rueda/tokens'`).

## Changer de palette en 1 étape

Dans `packages/tokens/config/theme.json`, remplacer la valeur de `"palette"` par l'identifiant d'une palette, puis recharger la page.

```json
{ "palette": "lienzo-azur", "colorScheme": "auto" }
```

| Identifiant                      | Direction (docs/design/US-028)                              |
| -------------------------------- | ----------------------------------------------------------- |
| `lienzo-tinta`                   | Lienzo · Tinta, **défaut** (choix du fondateur, 2026-11-02) |
| `lienzo-azur`                    | Lienzo · Azur                                               |
| `lienzo-grafito`                 | Lienzo · Grafito                                            |
| `cielo`                          | Cielo                                                       |
| `marina`                         | Marina                                                      |
| `voltio`                         | Voltio                                                      |
| `lagune`                         | Lagune                                                      |
| `senal`, `istmo`, `tierra-firme` | directions du 31 octobre, écartées, conservées              |

Sans commit, la variable d'environnement `THEME_PALETTE` fait la même chose (par exemple `THEME_PALETTE=marina`). `colorScheme` (ou `THEME_COLOR_SCHEME`) vaut `auto` (clair ou sombre selon l'appareil), `light` ou `dark`. Une palette ou un mode inconnu fait échouer le rendu : on ne retombe jamais en silence sur un autre thème.

- **Retoucher une palette** : modifier son fichier `docs/design/US-028/tokens-<id>.json` (et sa `meta.version`). Le contrôle de contraste s'applique au prochain chargement.
- **Design neuf** : déposer `docs/design/US-028/tokens-<id>.json` (même structure que Tinta, `meta.direction` = `<id>`), l'ajouter au registre `src/palettes.ts` (une ligne ; le test du registre échoue tant qu'il manque), puis le choisir comme ci-dessus.
- **Plus tard (US-034, US-120)** : le fondateur publiera une version de marque depuis le back-office. `loadTheme(id, surcharges)` accepte déjà des jetons partiels au même format, validés et contrôlés de la même façon.

## Ce que fait le paquet

| Étape       | Détail                                                                                                                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lecture     | `src/palettes.ts` importe **directement** les dix fichiers `docs/design/US-028/tokens-*.json` (aucune copie).                                                                                                                                                                                                                           |
| Socle       | `foundation.tokens.json` complète chaque palette des jetons ajoutés par US-030 (avatars, titre d'affichage, `radius.card`, `shadow.card` / `float`, verre, durées longues, _camino_, anneau de focus) par des **alias** vers ses propres jetons ; une palette peut les redéfinir (Tinta le fait).                                       |
| Validation  | `buildTheme` : alias `{chemin}` résolus (cycles et alias morts refusés), chaque valeur contrôlée selon son `$type` (`color` en `#RRGGBB`, `dimension`, `duration`, `cubicBezier`, `fontFamily`, `fontWeight`, `number`, ombres), jetons requis présents en clair et en sombre. Une valeur ne peut contenir ni `;`, ni accolade, ni `<`. |
| Contraste   | `checkContrast` : paires de `CONTRAST_RULES` (texte ≥ 4,5:1, composants et focus ≥ 3:1) en clair et en sombre, plus le texte sur le verre au **pire cas** (UX-49). `loadTheme` refuse le thème et nomme chaque paire en échec (`ThemeContrastError`).                                                                                   |
| CSS         | `themeStyleSheet` : variables à la racine, sombre par `prefers-color-scheme` ou `data-theme="dark"`, durées à `0s` avec `prefers-reduced-motion`, verre opaque avec `prefers-reduced-transparency` ou sans `backdrop-filter`, et règles de base (`BASE_CSS`) qui ne lisent que des variables.                                           |
| Thème actif | `getActiveTheme(process.env)` : appelé à chaque rendu par `apps/web/theme.tsx` et `apps/backoffice/theme.tsx`, qui injectent la feuille dans `<head>`.                                                                                                                                                                                  |

## Variables CSS disponibles

Toutes les palettes produisent **les mêmes noms** (un test le vérifie) : un composant écrit contre ces noms fonctionne avec n'importe quelle palette.

| Famille           | Variables                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Couleurs          | `--color-primary`, `--color-on-primary`, `--color-surface`, `--color-surface-raised`, `--color-surface-sunken`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-border-strong`, `--color-accent`, `--color-on-accent`, `--color-success(-soft)`, `--color-danger(-soft)`, `--color-warning(-soft)`, `--color-focus`, `--color-avatar-1…4`, `--color-on-avatar-1…4` |
| Typographie       | `--font-family-heading`, `--font-family-body`, `--font-family-mono`, `--font-weight-heading` / `body` / `strong`, `--font-size-xs…3xl`, `--font-line-height-body` / `heading`, `--font-display-family` / `weight` / `size` / `size-compact` / `letter-spacing` / `line-height`                                                                                                      |
| Espace et tailles | `--space-1…10`, `--size-touch-target`, `--size-action-bar`, `--size-focus-ring`, `--size-focus-offset`                                                                                                                                                                                                                                                                              |
| Formes            | `--radius-sm` / `md` / `lg` / `card` / `pill`, `--shadow-raised` / `card` / `float`                                                                                                                                                                                                                                                                                                 |
| Verre             | `--glass-bg`, `--glass-backdrop` (avec repli opaque), `--glass-opacity`, `--glass-blur`, `--glass-saturate`                                                                                                                                                                                                                                                                         |
| Mouvement         | `--motion-duration-fast` / `base` / `slow` / `enter` / `page` / `signature` / `skeleton`, `--motion-easing-standard` / `emphasis`, `--motion-iterations-skeleton`                                                                                                                                                                                                                   |
| _Camino_          | `--camino-stroke-width`, `--camino-dash-array` (couleur : `--color-focus`)                                                                                                                                                                                                                                                                                                          |

Règles d'usage (10b UX-49, UX-67 à UX-69) : `--color-border` n'est jamais seul contour d'un composant interactif (`--color-border-strong`) ; `--color-accent` ne porte jamais seul un état ; sur le verre, seuls `--color-text` et `--color-text-muted` sont contrôlés en texte (un lien `--color-primary` en texte sur le verre n'est pas prévu : l'ajouter à `GLASS_TEXT` avant de l'écrire) ; `--motion-duration-signature` ne sert qu'au tracé du _camino_ et au compteur de revenus.

## Lint des styles codés en dur

`pnpm lint` exécute `node packages/tokens/lint/cli.ts` (aussi `pnpm lint:style`). Il analyse `apps/web`, `apps/backoffice` et la future `packages/ui` (fichiers `.css`, `.scss`, `.ts`, `.tsx`, hors tests et configuration) et refuse : couleur hexadécimale, fonction de couleur (`rgb`, `hsl`, `oklch`…), couleur nommée ou système, police, taille de texte, graisse, espacement, rayon, ombre ou durée écrits en dur, et variable locale `--x` à valeur en dur. Permis : `var(--…)`, `calc()` et `color-mix()` de variables, `0`, `auto`, `none`, `inherit`, `currentColor`, `transparent`, `50%` pour un rayon. Il n'y a **pas de liste blanche** : un faux positif se corrige dans `lint/scan.ts`, avec une revue design. Le test `test/lint.test.ts` vérifie chaque règle et que le dépôt est propre.

## Tests

`pnpm --filter @rueda/tokens test:unit` : formule WCAG (valeurs de référence publiées, et **oracle indépendant** : chaque ratio consigné par US-028 dans `contrastChecks` de chaque palette est retrouvé à 0,01 près), registre complet, palettes valides et conformes, mêmes variables partout, valeurs Tinta de 10b UX-67, refus de contraste (clair, sombre, composant, avatar, verre), refus de format (injection CSS, type inconnu, jeton absent, alias), surcharges publiées, feuille générée, sélection et fail-closed, lint. Les entrées de cache turbo incluent `docs/design/US-028/tokens-*.json` et `apps/**` (`turbo.json` du paquet).

## Limites connues

- Les **fichiers de police** (Bricolage Grotesque, Manrope, OFL) ne sont pas encore servis : le rendu retombe sur `system-ui`. À héberger nous-mêmes (pas d'appel à Google Fonts depuis le navigateur), avec la bibliothèque de composants (US-032).
- La **version publiée en base** (`brand_version.tokens`, 17 §3.2.13) arrive avec US-034 ; d'ici là, la source est la configuration du dépôt et l'environnement.
- Le **nom de marque** (`brand.name` = Kmino dans les palettes) n'est pas encore lu par les applications (`BRAND_NAME` reste `{brand_name}`) : US-034.
