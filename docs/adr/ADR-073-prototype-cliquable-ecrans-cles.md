# ADR-073 — Prototype cliquable des écrans clés, route isolée `/proto`

- **Statut** : PROPOSÉ (US-033, agent design, claude-opus-5-5, 2026-11-03). Revues exigées : code et UX, sur un autre modèle que l'auteur. À reporter dans 17 §8.1.
- **Sources** : 19 US-033 ; 10b §4.1 (S01–S09, S15, S17, feuillets S02 · filtres et S09 · check-in), §4.2.1, §4.2.4, §4.3, §5.2 ; ADR-047 (jetons), ADR-055 (bibliothèque `@rueda/ui`), ADR-071 (quatre langues), ADR-024 (aucune constante pays).

## Contexte

Le fondateur approuve chaque écran clé **avant** son développement (DoR point 6). Il veut juger sur téléphone, à 360 px, dans les quatre langues, avec la direction Lienzo · Tinta, sans rien installer, et pouvoir changer le design plus tard sans tout refaire. Les maquettes US-028 étaient du HTML autonome : elles ne réutilisaient ni les jetons compilés, ni les composants, ni le catalogue de textes. Une autre story (US-048) construit en même temps la coquille de `apps/web`.

## Décision

1. **Route isolée `apps/web/app/proto/`** (`/proto` : index ; `/proto/<écran>` : écran) ; aucun fichier hors de ce dossier dans `apps/web`, pour ne pas croiser US-048. Paramètres d'URL : `lang` (locales de la configuration), `state` (états déclarés par écran), `theme` (`auto`, `light`, `dark`), `market` (marché fictif), `sel` (choix propre à l'écran : tri, plan, situation), `capture=1` (barre d'outils masquée). Tout est en liens et formulaires `GET` : le prototype fonctionne sans JavaScript, sauf l'estimateur de S01 (curseur doublé d'un champ, WCAG 2.5.7).
2. **Jamais actif en production** : ouvert sous `next dev`, sinon seulement si `WEB_PROTOTYPE_ENABLED` vaut exactement `true` (préproduction) ; sinon **404**. Lu à chaque requête côté serveur, jamais `NEXT_PUBLIC_*`. Pages `noindex`. Même patron que `/ui` (US-032) et `/lab/pwa-ios` (US-026).
3. **Écrans construits avec `@rueda/ui`** et un module CSS qui ne lit que des jetons (`pnpm lint` le vérifie) : changer de palette ou de jeton change le prototype sans retouche. Dix-sept icônes maison ajoutées à `Icon` (retour, fermer, recherche, réglages, calendrier, horloge, téléphone, message, clé, partage, document, personne, aide, globe, carburant, boîte de vitesses, trajet).
4. **Textes au format de `@rueda/i18n`** (clé plate, pluriels CLDR, emplacements `{nom}`), dans `apps/web/app/proto/copy/{es,en,fr,pt}.ts` : clés officielles lues dans `@rueda/i18n` ; clés de 10b §4.3 absentes du paquet reprises **mot pour mot** (es, en, fr ; pt rédigé) ; clés nouvelles **PROPOSÉES**, à verser dans 10b §4.3 et `@rueda/i18n` par la story qui implémente l'écran ; clés `proto.*` pour l'habillage, jamais livrées. On n'a pas ajouté ces ~300 textes au catalogue officiel : ils ne sont pas encore approuvés, et la fusion sur les catalogues partagés aurait croisé US-048. Tests : parité des quatre langues, aucune clé officielle redéfinie, typographie française, « une vue = une langue » sur chaque écran × état × locale × marché.
5. **Données fictives** dans `apps/web/app/proto/data/scenario.json` : deux marchés (deux décimales et sans décimale), montants déjà calculés en unités mineures, fuseaux, autorités, numéros d'exemple. Le prototype n'additionne aucun montant ; un test vérifie la cohérence des données (total = somme des lignes). Ce ne sont pas des oracles.
6. **Captures 360 px** dans `docs/design/US-033/captures/` (Chrome sans tête, protocole CDP), pour que le fondateur juge sans installer ; **approbation écran par écran** dans `docs/design/US-033/APPROBATIONS.md`, statut `EN ATTENTE` au départ, changé par le fondateur seul.

## Conséquences

- Un écran non approuvé bloque la story qui l'implémente ; l'implémentation reprend la structure de l'écran et verse ses clés PROPOSÉES dans le catalogue officiel.
- Le prototype est jetable : à supprimer (dossier `app/proto/` et variable) quand tous les écrans de la bêta seront livrés.
- L'espace hôte (A01–A13), O01 et S14 suivent dans une seconde demande de fusion de US-033 (passation).

## Alternatives écartées

- **HTML autonome comme US-028** : rapide, mais ni jetons compilés, ni composants, ni catalogue ; à refaire à l'implémentation.
- **Outil de maquette externe** : compte, licence et données hors du dépôt (refusé : aucun compte créé par un agent).
- **Textes dans `@rueda/i18n` tout de suite** : voir point 4.
