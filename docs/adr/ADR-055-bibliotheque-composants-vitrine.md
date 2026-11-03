# ADR-055 — Bibliothèque de composants : React et modules CSS sur jetons, vitrine dans l'application, axe-core sur jsdom

- **Statut** : PROPOSÉ (agent design, US-032, 2026-11-03). Prolonge ADR-047 (jetons). À reporter dans 17 §11.
- **Stories** : US-032 ; suites US-033 (maquettes construites avec la bibliothèque), US-034 (apparence). **Sources** : 19 US-032, 10b §3.1, §3.4, §3.5, §3.10 à §3.14, §4.1 ; 17 (tests d'accessibilité : axe-core).

## Contexte

Le fondateur veut voir chaque composant dans ses états, en es / en (fr ajouté par DEC-FONDATEUR-17), en clair et à 360 px, et juger le design sans développement. La story cite « Storybook ou équivalent ». La direction visuelle (Lienzo · Tinta) reste révisable : aucun style ne doit être figé dans les composants. 17 prévoit axe-core pour les tests d'accessibilité.

## Décision

1. **Paquet `@rueda/ui`** (propriétaire US-032 dans `review-requirements.json`) : composants React sans état ni dépendance d'exécution autre que `@rueda/i18n` (et React en pair). Ils sont utilisables en composant serveur ; les interactions (`onClick`) passent par les attributs natifs transmis.
2. **Styles** : un module CSS par composant, qui ne lit que les variables de `@rueda/design-tokens` ; le lint d'US-030 s'applique. Les couleurs ne sont posées que par **paires contrôlées** (`CONTRAST_RULES`, `GLASS_TEXT`), vérifiées par un test : le contraste vaut pour toute palette acceptée.
3. **Textes** : clés `@rueda/i18n` dans les trois langues, livrées ensemble ; les composants qui ont un texte propre reçoivent le traducteur (`i18n`). Montants : `MinorUnitAmount` formaté par `formatMoney`, aucun calcul dans l'interface.
4. **Vitrine dans l'application, pas Storybook** : `ComponentCatalog` est rendu par `apps/web` sur `/ui` avec la vraie feuille de thème, la vraie négociation de locale et le même build que la production. Ouverte en `next dev`, sinon par `WEB_UI_CATALOG_ENABLED=true` (préproduction), 404 par défaut, `noindex`.
5. **Accessibilité automatisée** : axe-core 4.14.0 exécuté dans un DOM jsdom 30.1.2 créé par le test (aucun environnement de navigateur global), règles WCAG 2.0 à 2.2 A / AA, sur la vitrine entière dans chaque locale et aux deux largeurs. `color-contrast` est remplacé par le contrôle des paires de jetons (jsdom ne calcule pas les styles). Dépendances de développement seulement, versions de plus de 14 jours (politique US-001).
6. **Polices (report d'US-030), PROPOSÉ, non appliqué** : héberger nous-mêmes Bricolage Grotesque et Manrope (OFL), sans appel à un service de polices depuis le navigateur. Options : (a) paquets npm `@fontsource-variable/bricolage-grotesque` et `@fontsource-variable/manrope`, figés dans le verrou ; (b) fichiers `woff2` versés dans le dépôt avec leur licence. Défaut fail-closed : **aucune nouvelle source externe sans accord** ; le rendu reste en `system-ui` (repli des jetons) jusqu'au choix.

## Conséquences

- Une page de la vitrine est servie par l'application : le drapeau doit rester absent en production (même règle que le laboratoire US-026).
- La vitrine ne fait pas de régression visuelle automatique ; à ajouter avec Playwright (captures 360 / 390 px) quand les écrans arriveront (US-033).
- Ajouter un composant : l'exporter dans `src/index.ts` **et** le montrer dans la vitrine (un test échoue sinon), avec ses clés en es, en et fr.

## Alternatives écartées

- **Storybook** : lourde chaîne de dépendances et un second build à maintenir ; il ne rend pas la feuille de thème injectée par le serveur ni la négociation de locale.
- **Bibliothèque de composants tierce** (Radix, MUI…) : styles et comportements à surcharger, dépendances d'exécution, identité moins maîtrisée.
- **Environnement de test navigateur global** (`environment: 'jsdom'`) : moins isolé ; le rendu serveur + jsdom par test suffit.
- **`next/font/google`** : télécharge les polices au build depuis un service externe.
