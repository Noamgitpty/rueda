# ADR-047 — Jetons de design : palettes US-028 comme source unique, compilées à la requête

- **Statut** : PROPOSÉ (agent design, US-030, 2026-11-03). Précise ADR-036 (thème piloté par les données, décidé par le fondateur) sans le modifier. À reporter dans 17 §11.
- **Stories** : US-030 ; suites US-032 (bibliothèque), US-034 et US-120 (version de marque publiée, écran « Apparence »). **Sources** : 19 US-030, 10b §3.10, §3.14 (UX-49, UX-67 à UX-69), §8 ; `docs/design/US-028/PROPOSITIONS.md` (« Langage visuel ») ; passations US-028 et US-059.

## Contexte

Le fondateur a choisi Lienzo · Tinta mais veut pouvoir la retoucher, revenir à une autre palette de US-028 ou demander un design neuf, sans développement. Dix fichiers DTCG existent déjà dans `docs/design/US-028/`, avec leurs contrôles de contraste. 10b UX-67 désigne `tokens-lienzo-tinta.json` comme source qui fait foi. ADR-036 prévoit des jetons en base (`brand_version.tokens`) appliqués en variables CSS, avec un contrôle AA bloquant à la publication.

## Décision

1. **Source unique** : le paquet `@rueda/tokens` importe les fichiers `docs/design/US-028/tokens-*.json` **tels quels** (aucune copie). Un registre (`src/palettes.ts`) les liste ; un test échoue si un fichier du dossier n'y est pas.
2. **Socle commun** : les jetons ajoutés après US-028 (avatars, titre d'affichage, `radius.card`, ombres `card` / `float` avec valeur sombre en `$extensions["org.rueda"].dark`, verre, durées 280 / 300 / 700 / 1 400 ms, _camino_, anneau de focus) ont une valeur par défaut dans `packages/tokens/foundation.tokens.json`, écrite en **alias** vers les jetons de chaque palette. Toutes les palettes produisent donc les mêmes variables CSS. Tinta (0.2.0) porte ses propres valeurs, reprises de `presentation.html` et de PROPOSITIONS.
3. **Validation stricte, fail-closed** : chaque valeur est contrôlée selon son `$type` ; un type inconnu, un alias mort, un jeton requis absent ou une palette inconnue sont des erreurs. Les valeurs admises ne peuvent pas sortir d'un bloc CSS, ce qui permettra d'injecter sans risque des jetons venus de la base.
4. **Contraste à chaque chargement** : un seul jeu de paires sémantiques (`CONTRAST_RULES`) et une seule formule (`src/wcag.ts`), en clair et en sombre, plus le texte sur le verre au pire contenu dessous. Le même contrôle servira à la publication (US-034, US-120).
5. **Compilation à la requête** : les applications appellent `getActiveTheme(process.env)` à chaque rendu serveur et injectent la feuille dans `<head>`. Rien n'est figé au build : changer la source s'applique au rechargement. Sélection : `config/theme.json` (versionné), surchargeable par `THEME_PALETTE` et `THEME_COLOR_SCHEME`.
6. **Lint maison** : un analyseur sans dépendance (`lint/scan.ts`) refuse les valeurs de style en dur dans les composants, CSS comme TSX ; il tourne dans `pnpm lint` et dans les tests.

## Conséquences

- Les fichiers de `docs/design/US-028/` deviennent du code de production : les modifier change le rendu, et les tests du paquet les valident. Ils restent la propriété de l'agent design ; une retouche passe par une revue design.
- Le nom du dossier (`US-028`) reste dans les chemins d'import ; le déplacer obligerait à réviser 10b, qui cite ce chemin.
- La version publiée en base remplacera la configuration comme source au moment de US-034 ; `loadTheme(id, surcharges)` en est déjà le point d'entrée.
- Le lint par motifs peut produire un faux positif ; il n'a pas de liste blanche, et on le corrige dans l'analyseur.

## Alternatives écartées

- **Copier les palettes dans le paquet** (avec un test de dérive) : deux copies d'une même donnée, contraire à « source unique ».
- **Générer un fichier CSS au build** (Style Dictionary ou script) : impose une reconstruction pour chaque changement et contredit le critère « sans déploiement » ; ajoute une dépendance.
- **Règle ESLint** : ne voit pas les fichiers `.css` et toucherait `packages/config` (autre propriétaire) ; l'analyseur couvre CSS et TSX avec la même règle.
