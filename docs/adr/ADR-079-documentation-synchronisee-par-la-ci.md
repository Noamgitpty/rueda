# ADR-079 — Documentation d'architecture, d'API, de schéma et glossaire tenus à jour par la CI

- **Statut** : PROPOSÉ (US-038, agent back-end, claude-opus-5-5, 2026-11-04). Revues exigées : code et architecture (story), sécurité (`packages/db/`, `scripts/ci/`), sur un autre modèle que l'auteur. À reporter dans 17 §8.1 (journal des ADR) et §12 (portes CI).
- **Sources** : 19 US-038 ; 17 §2.1, §2.2 (modules et « Dépend de »), §3 (modèle de données), §8.1, annexe B (glossaire) ; 16 A.8 (codes d'erreur), A.8.2 ; passations US-041 (amorce OpenAPI, `x-rueda-pending`) et US-035 (incohérences code / 17) ; ADR-074 (contrat OpenAPI), ADR-077 (matrice des routes, durcissement HTTP).

## Contexte

L'amorce OpenAPI d'US-041 ne décrivait que `/brand*` et `/auth/*` : 18 routes (staff, console, webhooks) restaient dans `x-rueda-pending`. Aucun document du schéma réel n'existait. La carte des modules n'existait que dans 17 (la cible), sans vue de l'état du code. Le glossaire d'US-014 ne couvrait que l'interface et gardait du vocabulaire de loueur. US-035 avait relevé des écarts entre le code et 17 sans les trier. Le critère de 19 est que **la CI échoue** quand une documentation n'est plus conforme au code.

## Décision

1. **Contrat OpenAPI complet, vérifié contre le code.** `apps/api/openapi/openapi.json` décrit les 27 opérations, avec leurs schémas, statuts, codes d'erreur stables et en-têtes. `x-rueda-pending` disparaît. Le contrat reste **écrit à la main**, et cinq contrôles l'empêchent de dériver (`test:unit`) :
   1. **routes** : les routes montées par Nest (`ApiModule` réel, journal « Mapped ») = les opérations du contrat = la lecture des décorateurs ;
   2. **codes d'erreur** : chaque `const` / `enum` de `code` existe dans un catalogue du code (`AUTH_MESSAGES`, `BRAND_MESSAGES`, `RISK_MESSAGES`, `hygienicCode`) au même statut HTTP ; les surcharges de statut forment une liste fermée relue dans les sources ;
   3. **couverture** : chaque statut déclaré est observé par une suite de contrat (`CONTRACT_SUITES` : une suite par préfixe, `missingCoverage` vide) sur l'application réelle (harnais d'US-043, adaptateurs remplacés seulement) ;
   4. **conformité** : chaque réponse observée valide le contrat (`ContractClient`, Ajv strict) ;
   5. **référence publiée** : `docs/architecture/api.md` est régénéré depuis le contrat et comparé au fichier commité.
2. **Réponses transverses.** `x-rueda-transverse-responses` déclare ce que produisent la garde anti-abus globale et le durcissement HTTP devant toute route : 403 `BOT_CHALLENGE_REQUIRED`, 413 `PAYLOAD_TOO_LARGE`, 429 `RATE_LIMITED` avec `Retry-After`, 500 `INTERNAL_ERROR`. Le harnais accepte une réponse si elle valide la réponse de l'opération **ou** la réponse transverse de même statut. Chaque réponse transverse est observée par `transverse.contract.test.ts`.
3. **Schéma réel généré depuis la base.** `packages/db/src/schema-doc.ts` lit le catalogue (`pg_catalog`) de la base « production » du banc, celle des seules migrations de production, sous `app_api` (L0-05). Il produit `docs/architecture/schema.md` : historique des migrations, rôles et appartenances, schémas, tables (RLS `ENABLE` / `FORCE`, droits par rôle, colonnes, contraintes, index, politiques, déclencheurs), vues, fonctions `SECURITY DEFINER` (propriétaire, `search_path`, `EXECUTE`) et autres fonctions. Le rendu est déterministe : aucun OID ni nom de base, tri par nom. `test/int/schema-doc.test.ts` le compare au fichier commité dans `pnpm test:int` (job CI « base de données »). En cas d'écart, le document attendu est imprimé entre deux marqueurs dans le journal du job. Aucun PostgreSQL local n'est exigé.
4. **Architecture générée depuis le code.** `docs/architecture/modules.md` est généré depuis `dependency-graph.ts`, `packages/db/schemas.ts`, les imports réels des fichiers de production, les routes des contrôleurs et les `package.json`. Il contient deux diagrammes mermaid (modules, paquets) et l'état de chaque module (coquille, ports seulement, construit). `docs/architecture/README.md` (écrit à la main) porte le contexte et le cycle d'une requête ; le job `diagrammes` rend chaque diagramme avec `mmdc`. Deux tests ajoutent :
   - les imports réels ne sortent jamais du graphe (lecture indépendante du lint) ;
   - le graphe `dependsOn` = la colonne « Dépend de » de 17 §2.2, avec une liste fermée d'écarts assumés (CFG → BUS, AUD → BUS, déjà à reporter dans 17).
5. **Glossaire quadrilingue.** `docs/glossary.md` gagne une section « Termes métier » en es, fr, en et pt. Chaque terme de 17 annexe B y a sa ligne, ainsi que les termes de l'interface (trip, réservation, caution, versement…) avec leur clé de catalogue. `scripts/ci/glossary.test.mjs` exige les quatre langues, chaque terme de l'annexe B et l'absence de vocabulaire de loueur dans la colonne espagnole.
6. **Écarts code / spécification.** Ils sont tranchés dans `docs/team/PROPOSITIONS.md`. Un bug du code est corrigé s'il est petit : flèche PAY → CTR retirée du graphe, responsabilités P2P, corps du 500, glossaire. Sinon il est tracé avec la story qui le corrigera, et un garde-fou l'empêche de s'étendre (`table-prefix.test.ts`). Une spécification à mettre à jour devient une proposition PROPOSÉE, pour une demande de fusion de spécification revue. `docs/specs/` n'est pas modifié.
7. Les trois fichiers générés sont exclus de Prettier (`.prettierignore`) : la CI les compare octet par octet. Régénération : `RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/api exec vitest run src/testing/docs` (modules, API) ; le schéma se régénère dans le job « base de données » ou sur un banc local avec `RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/db test:int`.

## Conséquences

- Une route, un code d'erreur, un statut, une migration, une dépendance de module ou un terme de l'annexe B ajoutés sans leur documentation font échouer la CI, avec la commande de régénération dans le message.
- Une story qui ajoute une route écrit son entrée OpenAPI et sa suite de contrat, ou complète la suite du préfixe. Une migration demande de recopier `schema.md` depuis le journal CI (ou depuis un banc local).
- Un corps d'erreur interne est désormais `{ code: INTERNAL_ERROR, messageKey }` : le corps `{ statusCode, message }` de Nest n'est plus servi.

## Options écartées

- **Générer l'OpenAPI depuis les décorateurs** (`@nestjs/swagger`). Les contrôleurs reçoivent des corps `unknown`, validés à la main et refusés avec des codes stables : un générateur exigerait des classes DTO dans chaque module, et ses schémas seraient plus faibles (pas de `const` de code d'erreur, pas d'en-têtes requis). La vérification croisée apporte la même garantie de non-dérive sans réécrire les contrôleurs.
- **Publier le contrat comme artefact de CI.** Le contrat et sa référence sont dans le dépôt et vérifiés à chaque CI ; un artefact n'ajouterait qu'un double sans contrôle de plus, et toucherait les workflows (revue sécurité) sans nécessité.
- **Générer le schéma sous `migrator` ou le superutilisateur.** Le catalogue est lisible par `app_api` : la génération respecte L0-05 comme tout test.
- **Formater les fichiers générés avec Prettier dans le test.** Cela ajouterait une dépendance à `@rueda/api` pour un gain de lisibilité nul sur un fichier qu'on ne relit pas en diff.

## Hors périmètre

- La limite de corps propre aux webhooks (256 Kio, 17 §4.4) : TRACÉ, PROP-038-08.
- Le renommage de `core.ntf_notification_dispatch` : TRACÉ, PROP-038-03.
- Le report de ces décisions dans 17 et 16 : demandes de fusion de spécification (PROP-038-04 à 06, 11).
