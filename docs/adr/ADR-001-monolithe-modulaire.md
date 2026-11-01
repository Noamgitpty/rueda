# ADR-001 — Monolithe modulaire TypeScript (NestJS + Next.js), une base PostgreSQL, schéma par module

- **Statut** : DÉCIDÉ (acté par l'orchestrateur au début du lot 0, 2026-10-31 ; 17 §8.1 le donnait PROPOSÉ « à acter au lot 0 »)
- **Story** : US-001
- **Références** : 17 §8.1 (ligne ADR-001), §2.1, §2.2, §6.1, §10 point 3, D1 ; 18 §5 ; 19 US-001

## Contexte

Le build est fait par une équipe d'agents, sans développeur humain (DEC-FONDATEUR-05). Le volume initial est faible (5 à 10 agences), mais les exigences sont fortes sur l'argent, la concurrence et la preuve. Plusieurs flux exigent une seule transaction à travers des modules : transition SM-1 dans AVL, règlement dans STL, instances SM-8 et `payment_command` dans PAY, sous le verrou du `trip` (17 D1, 08 E4). Il faut des frontières nettes, que des agents différents puissent respecter et qu'une machine puisse vérifier.

## Décision

- **Un seul déployable back-end** : NestJS, une image, deux processus (`apps/api/src/main.ts` pour l'API HTTP et `apps/api/src/worker.ts` pour le travailleur pg-boss, ADR-011).
- **Un module Nest par bounded context** de 17 §2.2 (IAM, KYC, CAT, AVL, PRC, CTR, PAY, STL, PYO, TRP, CLM, MSG, NTF, REV, SUP, FIN, RISK, CFG, AUD, RPT), plus BUS (outbox, socle de 17 §2.1). Chaque module expose un seul point d'entrée public, `index.ts`.
- **Frontières vérifiées en CI** par la règle ESLint `rueda/module-boundaries`. Les dépendances autorisées sont une donnée (`apps/api/src/modules/dependency-graph.ts`) reprise de 17 §2.2, avec un socle implicite CFG, AUD, BUS. Le graphe est acyclique, et un test le prouve.
- **Une base PostgreSQL**. Cible : un schéma par module. Bêta pilote : un schéma unique avec un préfixe de table par module (`avl_trip`), conformément à 17 §10 point 3. Les écritures dans les tables d'un autre module sont interdites. Un appel d'interface peut participer à la transaction de l'appelant.
- **Front Next.js** (App Router) dans le même monorepo pnpm + Turborepo : `apps/web` (guest, console agence, comptoir PWA) et `apps/backoffice` (back-office interne, domaine distinct).

## Conséquences

- Une seule chaîne de build, de test et de déploiement, adaptée à une petite équipe d'agents.
- Les transactions inter-modules restent possibles et simples (frontière ≠ transaction).
- Le découpage en services reste possible module par module : les frontières sont déjà contrôlées (17 §8.1, colonne « Conséquence »).
- Toute nouvelle dépendance entre modules est une décision d'architecture : modification du graphe, ADR, report dans 17 §2.2, revue de l'agent architecture.
- La règle ne voit que les imports relatifs. Un alias de chemin introduit plus tard devra être pris en compte par la règle.
- **Écart relevé** : 17 §10 point 3 prévoit en Bêta « une application Next.js », le back-office étant « le même code servi sur un domaine distinct ». 17 §6.1 et la consigne de US-001 demandent une application séparée. US-001 crée `apps/backoffice` séparé. Les deux applications pourront être fusionnées si l'orchestrateur le décide, car le coût est faible à ce stade.

## Alternatives

- **Microservices dès le départ** : rejeté. Exploitation lourde, transactions distribuées sur les flux d'argent, aucun besoin mesuré.
- **Fastify + modules maison** : plus léger, mais sans injection de dépendances ni structure de modules standard (17 §6.1).
- **tRPC** : couplage fort entre le front et le back (17 §6.1).
- **Un schéma par module dès la Bêta** : reporté. 17 §10 point 3 retient le schéma unique à préfixe pour simplifier l'infrastructure de la Bêta.
