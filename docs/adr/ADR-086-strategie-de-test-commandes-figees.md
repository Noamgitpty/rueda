# ADR-086 — Stratégie de test exécutable : commandes figées et document contrôlé par un test

- **Statut** : PROPOSÉ (US-039, agent back-end, claude-opus-5-5, 2026-11-05). Revue exigée : code. À reporter dans 17 §8.1 (journal des ADR) et §12 (portes CI, liste des commandes).
- **Sources** : 19 US-039 (critères : savoir lancer chaque famille de tests ; guide de contribution applicable par un humain), 19 §1.8 (stratégie de tests), handoff §7 (commandes « PROPOSÉES, figées par US-002 / US-039 dans le `package.json` racine »), 17 §11 et §12.

## Contexte

Le handoff §7 propose dix commandes racine. US-002 en a créé cinq (`lint`, `typecheck`, `test:unit`, `test:int`, `test:l0`). Les autres suites existent, mais sous d'autres noms et dans les paquets qui les portent : `@rueda/money` `test:oracle` et `test:mutation` (US-042), `@rueda/db` `test:c11` (US-025), `@rueda/web` `test:e2e` (US-041). Il manquait un document qui dise comment lancer chaque famille, et rien n'empêchait un tel document de dériver : une commande renommée, un job supprimé, une suite nouvelle jamais décrite.

## Décision

1. **Document de référence** : [`docs/qa/STRATEGIE_TESTS.md`](../qa/STRATEGIE_TESTS.md). Pour chaque famille de 19 §1.8, il donne la commande, l'emplacement, le job de CI, l'état réel et les écarts connus (§5). La spécification reste la source qui fait foi.
2. **Deux commandes racine ajoutées**, simples alias de suites déjà jouées par la CI :
   - `pnpm test:money` = `@rueda/money` `test:unit` (vecteurs dorés T, TJ, TA en USD et PYG) puis `test:oracle` (10 000 cas contre les oracles Python). Mêmes commandes que les jobs `qualite` et `argent-oracles`.
   - `pnpm test:e2e` = build de production de `@rueda/web`, puis Playwright. Mêmes commandes que le job `e2e-web`.
3. **Trois noms du handoff ne sont pas créés** :
   - `test:rls` et `test:concurrency` : les preuves RLS-1 à RLS-28 et C1–C20 sont réparties dans les fichiers de `test:l0` et dans `test:c11`, souvent plusieurs identifiants par fichier. Un alias filtré par titre de test (`-t "RLS-"`) laisserait de côté les preuves dont le titre ne cite pas l'identifiant, et ne serait joué tel quel par aucun job : il pourrait passer au vert sans rien prouver. Le document indique comment lancer un fichier seul et comment retrouver un identifiant (`git grep -nw`).
   - `test:nightly` : réservé à US-047 (régression complète et rapprochement). Aujourd'hui, la nuit est le workflow `nightly.yml`.
4. **Contrôle** `scripts/qa/test-strategy.test.mjs` (`node:test`, dans `pnpm test:unit`, job `qualite`). Il échoue si :
   - une commande `pnpm …` citée dans le document ou dans `CONTRIBUTING.md` n'existe pas (script racine, script du paquet filtré, tâche Turborepo) ;
   - un script `test:*` d'un `package.json` du dépôt n'est pas cité dans le document (mot entier) ;
   - un job de la colonne « Job CI » n'existe pas dans `ci.yml` ou `nightly.yml`. Le test prouve l'**existence** du job, pas qu'il joue la commande de sa ligne, ni que chaque job est cité ;
   - un chemin sans joker de la colonne « Emplacement », ou un script lancé par `bash`, `node` ou `python`, n'existe pas ;
   - un lien relatif est cassé, ou une famille exigée par US-039 manque (dont la sécurité, les données personnelles et les gabarits) ;
   - la liste des contrôles ASVS niveau 2 (§3.9, attendue par 19 US-043 et ADR-077) perd l'un des contrôles V4, V8.3, V12.1, V13.1 ou V14.4, ou une ligne sans preuve ni story ;
   - un nom réservé du handoff (`test:rls`, `test:concurrency`, `test:nightly`) n'est ni créé ni marqué « réservé » ou « non créé » dans le document ;
   - `CONTRIBUTING.md` ne décrit pas chaque rôle de revue et chaque chemin protégé de `docs/team/review-requirements.json`.
5. Le contrôle vit dans un **nouveau dossier `scripts/qa/`**, ajouté à `test:unit`. Il ne touche ni `scripts/ci/` ni `.github/`, qui exigent une revue sécurité : il ne fait que lire ces fichiers.

## Conséquences

- Renommer une suite, supprimer un job ou ajouter un `test:*` sans mettre le document à jour fait échouer `qualite`. Le document reste donc lançable par un repreneur (19 §1.8).
- La lecture du YAML est volontairement simple (clés de second niveau sous `jobs:`, indentées de deux espaces). Un changement de style d'indentation des workflows ferait échouer le test : on l'adaptera alors.
- Ne sont pas contrôlés : les arguments des commandes, les commandes `gh` et `tofu`, et le contenu des jobs. Ils se relisent en revue.
- Les écarts avec 19 §1.8 (parcours dorés PA / PY, axe, seuils de couverture, nuit complète) sont listés, pas comblés : ils appartiennent à US-044, US-045, US-047 et suivantes (Q-011 pour les seuils de couverture).

## Alternatives écartées

- **Créer les dix commandes du handoff** : `test:rls` et `test:concurrency` en alias filtrés seraient trompeurs (point 3). Les brancher dans un nouveau job de CI toucherait `.github/` pour rejouer des tests déjà joués par `base-de-donnees`.
- **Contrôle dans `scripts/ci/`** : c'est l'emplacement naturel des contrôles de dépôt, mais il impose une revue sécurité et les garde-fous de DEC-FONDATEUR-15 pour un test qui ne protège aucune porte de fusion.
- **Document sans contrôle** : il dériverait à la première story qui renomme une suite.
