# packages/ui — bibliothèque de composants vivante (`@rueda/ui`)

Livré par **US-032** (lot 0, DSN-005). Composants React de la bêta, **accessibles** (WCAG 2.2 AA, clavier, lecteurs d'écran, cibles de 48 px), **quadrilingues** (textes par `@rueda/i18n`, es / en / fr / pt-BR, DEC-FONDATEUR-18), **clair et sombre**, conçus d'abord pour le **mobile** (360 px). Ils sont écrits **uniquement** contre les variables CSS des jetons (`@rueda/design-tokens`, US-030) : changer de palette ou de direction ne touche pas ce paquet. Décision : ADR-055.

Points d'entrée : `@rueda/ui` (`src/index.ts`, composants) et `@rueda/ui/catalog` (vitrine). Publié en TypeScript source ; les applications Next le transpilent (`transpilePackages`).

## Responsabilité

Fournir les composants React de la bêta et la vitrine vivante, écrits contre les variables des jetons et les textes de `@rueda/i18n`.

## Entités

Aucune entité persistée : les composants reçoivent leurs données en propriétés ; les exemples de la vitrine sont des fichiers du dépôt.

## Événements

Aucun événement de domaine : le paquet ne fait que du rendu.

## Ports

Aucun port : les seules dépendances sont `@rueda/design-tokens` et `@rueda/i18n`.

## Composants

| Composant                                              | Usage (10b)                                                       | Points d'accessibilité                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `ButtonLink`                                 | actions (UX-52), barre d'action (`block`)                         | `type="button"` par défaut, 48 px, `aria-busy` en chargement ; l'action principale n'est jamais désactivée (UX-50)                                   |
| `IconButton`                                           | « enregistrer » sur la carte (verre)                              | nom accessible obligatoire, `aria-pressed`, 48 × 48 px, repli opaque du verre                                                                        |
| `TextField`, `Checkbox`                                | formulaires (UX-50)                                               | libellé visible, aide et erreur liées (`aria-describedby`), `aria-invalid`, « (opcional) » ; case jamais pré-cochée (UX-56)                          |
| `ErrorSummary`                                         | récapitulatif d'erreurs en tête (UX-50)                           | `role="alert"`, un lien par champ, titre au pluriel                                                                                                  |
| `Badge`                                                | « Nuevo », « Identidad verificada »                               | icône + texte pour un état (jamais la couleur seule, UX-48) ; aucun badge de statut d'hôte (UX-65)                                                   |
| `Avatar`                                               | monogramme de l'hôte (UX-70)                                      | décoratif si le nom est écrit à côté, sinon `role="img"`                                                                                             |
| `Rating`                                               | étoile + chiffre + trips (UX-65)                                  | « Valoración: 4,9 de 5 » lu par les lecteurs d'écran ; sans avis : « Nuevo »                                                                         |
| `Price`, `PriceBreakdown`                              | prix final TTC (UX-15, UX-16), détail (UX-17)                     | `formatMoney` de US-014, **aucun calcul** ; `live` annonce un prix recalculé (UX-20) ; `<details>` natif                                             |
| `CarCard`, `CarCardSkeleton`                           | carte de S02 (UX-65)                                              | lien étiré (une tabulation, nom = modèle), anneau de focus sur la carte, squelette au même gabarit                                                   |
| `CarIllustration`                                      | voiture dessinée maison (UX-70)                                   | décorative                                                                                                                                           |
| `HostCard`                                             | « Tu anfitrión / anfitriona » de S03 (UX-65)                      | titre par clé (masculin, féminin, neutre), section nommée par son titre                                                                              |
| `DepositBlock`                                         | bloc caution de S03 et S05 (UX-21 à UX-23)                        | les six réponses fixes, date au fuseau du véhicule, avertissement du débit puis remboursement                                                        |
| `Banner`                                               | hors connexion, succès, attention, erreur                         | `live` : `status` (poli) ou `alert` (assertif) ; icône + texte                                                                                       |
| `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton` | états de 10b §4.1, §3.12                                          | erreur assertive avec code de support ; chargement annoncé une fois (`role="status"`) ; squelettes décoratifs, arrêtés avec `prefers-reduced-motion` |
| `Steps`                                                | étapes du checkout, de l'inscription hôte                         | « Paso 2 de 4 » écrit, `aria-current="step"`, « completado » lu                                                                                      |
| `PhotoSlot`                                            | capture photo de remise / retour (TRP-004)                        | bouton nommé « Tomar foto: Frente », état écrit (enregistrée, envoi, échec)                                                                          |
| `DataTable`                                            | tableaux de la console de l'hôte                                  | légende, `scope` de colonnes et de lignes, région défilante focalisable                                                                              |
| `Icon`                                                 | icônes maison en `currentColor` (27, dont 17 ajoutées par US-033) | toujours `aria-hidden`                                                                                                                               |

Les textes passés en `children` ou en propriétés sont **déjà traduits** par l'appelant ; les textes propres aux composants viennent des clés `common.ui.*`, `common.price.*` et des clés de 10b §4.3 (`web.deposit.*`, `web.s03.host.*`…). Les montants sont des `MinorUnitAmount` (`bigint` en unités mineures) calculés ailleurs (devis, PRC-025) ; les dates arrivent avec le fuseau IANA du véhicule.

```tsx
import { CarCard, IconButton } from '@rueda/ui';

<CarCard
  i18n={i18n}
  href={`/autos/${car.id}`}
  title={`${car.model} ${car.year}`}
  host={{ name: host.firstName }}
  rating={car.rating}
  trips={car.trips}
  total={quote.total}
  perDay={quote.perDay}
  days={quote.days}
  saveAction={
    <IconButton
      icon="heart"
      label={i18n.t('common.ui.car.save', { car: car.model })}
      pressed={saved}
      onClick={toggle}
    />
  }
/>;
```

## Styles

Un module CSS par composant (`*.module.css`), qui ne lit que `var(--…)` : le lint d'US-030 (`pnpm lint`) refuse toute valeur en dur. Règles suivies :

- une seule couleur d'action, `--color-primary` (UX-68) ; `--color-border` n'est jamais seul contour d'un élément interactif (`--color-border-strong`, UX-49) ;
- chaque bloc qui pose une couleur de texte **et** un fond utilise une **paire contrôlée** par `CONTRAST_RULES` (texte ≥ 4,5:1) ou le verre (`GLASS_TEXT`) : le contraste est garanti par construction pour toutes les palettes acceptées (`test/tokens.test.ts`) ;
- cibles interactives de `--size-touch-target` (48 px), anneau de focus du thème ;
- durées et courbes des jetons ; toute animation s'arrête avec `prefers-reduced-motion` (UX-69).

Le thème sombre ne demande rien aux composants : la feuille du thème change les variables.

## Vitrine vivante

`ComponentCatalog` (`@rueda/ui/catalog`) montre chaque composant dans ses états (normal, vide, chargement, erreur, désactivé). L'application web la monte sur **`/ui`** :

- `?lang=es-PA|es-PY|en|fr` (locales déclarées dans `@rueda/i18n/config/locales.json`), `?theme=auto|light|dark`, `?width=mobile|full` (360 px par défaut) ; les commandes sont de simples liens ;
- ouverte en `next dev`, sinon seulement avec `WEB_UI_CATALOG_ENABLED=true` (préproduction) ; 404 par défaut ; `noindex`. Voir `apps/web/README.md`.

Les données d'exemple (`src/catalog/samples.json`) sont des **données** non normatives : une voiture en USD (exposant 2), une en PYG (exposant 0), un fuseau ; le code n'en contient aucune constante de pays.

## Commandes de test

`pnpm --filter @rueda/ui test:unit` :

- **accessibilité** (`test/catalog.test.tsx`) : la vitrine entière, dans chaque locale, en pleine largeur et à 360 px, passée à **axe-core** (règles WCAG 2.0 à 2.2, A et AA) dans un DOM jsdom isolé : 0 violation exigée. `color-contrast` est écartée (jsdom ne calcule pas les styles) et remplacée par le contrôle des paires de jetons. Un test prouve que le harnais détecte une faute ;
- **trois langues** : une vue = une langue (`findForeignStrings`), aucune variable non résolue, trois rendus différents ; la parité des catalogues est testée par `@rueda/i18n` ;
- **prix** (`test/price.test.tsx`) : formats USD et PYG des quatre locales, attendus recopiés du README de `@rueda/i18n` (`test/fixtures/amounts.json`), refus d'un montant flottant ;
- **comportements** (`test/components.test.tsx`) : liens d'erreur, `aria-*`, six réponses du bloc caution, formes du titre de l'hôte, étapes, case photo, tableau ;
- **jetons** (`test/tokens.test.ts`) : chaque `var(--…)` existe dans toutes les palettes acceptées, paires de contraste, cibles de 48 px, mouvement réduit, et le lint des styles ne trouve rien dans `packages/ui` ni dans `apps/web/app/ui`.

## Limites connues

- **Polices** : Bricolage Grotesque et Manrope ne sont pas encore servies (rendu en `system-ui`). Hébergement proposé dans ADR-055, en attente d'accord sur la source des fichiers.
- Pas de Storybook : la vitrine est une page de l'application (ADR-055). Elle n'a pas de captures de référence automatiques (régression visuelle) ; la revue design se fait sur `/ui`.
- Les textes `web.catalog.*` (vitrine) et les clés `common.ui.*` ajoutées sont PROPOSÉS : à reporter dans 10b §4.3 par une demande de fusion sur les spécifications.
- Contrôle manuel TalkBack / VoiceOver (UX-46) non fait : à prévoir avec la revue UX.
