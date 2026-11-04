# ADR-074 — Tests de contrat d'API depuis l'OpenAPI et parcours e2e Playwright mobiles et PWA

- **Statut** : PROPOSÉ (US-041, agent front-end, claude-opus-5-5, 2026-11-03). Revues exigées : code et QA ; sécurité (`.github/`). À reporter dans 17 §8.1.
- **Sources** : 19 US-041 et §1.8 (niveaux « Contrat d'API » et « Bout en bout ») ; 17 §9 (contrat OpenAPI, ADR-032) ; 10b §3.1, §4.3, §5.2 ; ADR-072 (coquille PWA) ; passation US-048 (report du contrôle à 360 px en CI).

## Contexte

Les contrôles de la coquille à 360 px (US-048, `apps/web/scripts/shell-check.mjs`) ne tournaient qu'en local. Aucun harnais e2e ni aucun test de contrat n'existait. US-041 dépend d'US-038 (OpenAPI générée depuis le code), qui n'est pas livrée : il n'y a pas encore de spécification OpenAPI dans le dépôt.

## Décision

1. **Contrat OpenAPI 3.1 écrit à la main en amorce** : `apps/api/openapi/openapi.json` décrit les routes publiques de marque (US-034) et d'authentification (US-010), avec des **codes d'erreur stables** (`const` / `enum` par réponse, 16 A.8) et des en-têtes requis (`Cache-Control`, `ETag`, `Set-Cookie`). Les autres routes sont listées dans `x-rueda-pending`. US-038 remplacera l'amorce par une spécification générée ; le harnais et les tests restent.
2. **Harnais** `apps/api/src/testing/openapi-contract.ts` (exclu du build) : Ajv 2020-12 en **mode strict** ; une réponse réelle est refusée si le chemin, la méthode, le statut (pas de `default`), le type de contenu, le corps ou un en-tête requis n'est pas conforme. `ContractClient` confronte chaque réponse **avant** de la rendre au test. Les tests `*.contract.test.ts` tournent dans `test:unit` (Nest sur 127.0.0.1, FAKE, sans base) et vérifient que chaque statut déclaré est exercé. Un test lit les décorateurs de chaque contrôleur : une route absente du contrat (ou fantôme) fait échouer la CI.
3. **Playwright** (`@playwright/test` 1.64.1, figé) dans `apps/web/e2e/`, contre le **build de production** (`next start`). Navigateur : le **Google Chrome installé** (`channel: 'chrome'`), comme le job `diagrammes` ; aucun binaire téléchargé. Projets : `mobile-360`, `mobile-390`, `tablette` (coquille : 4 langues, clair et sombre, hors ligne, cibles ≥ 44 px, aucun défilement horizontal, choix de langue) et `pwa` (manifeste, service worker réel, application installée).
4. **Variante « PWA installée »** : Chrome refuse toute installation depuis un contexte incognito (celui de chaque test Playwright, erreur `in-incognito`) et ne permet pas d'émuler `display-mode`. Le test lance donc Chrome en **fenêtre d'application** (`--app=<origine>/`, `display-mode: standalone`) sur un profil jetable, s'y connecte par CDP, lit le verdict d'installabilité de Chrome (vide) et l'identifiant de l'application, puis joue le parcours hors ligne dans cette fenêtre.
5. **Déterminisme** : aucune relance, mouvement réduit, fuseau UTC, `Date` figée ; toute requête réseau vers un autre hôte que le serveur testé fait échouer le test ; valeurs attendues tirées de 10b §4.3 (`e2e/oracle.ts`), jamais du code testé ; données fictives seulement.
6. **CI** : nouveau job parallèle `e2e-web` de `ci.yml` (build du site, puis parcours), permissions héritées `contents: read`, actions épinglées par SHA, sans secret ni `continue-on-error`. Le job `revues` n'est pas modifié.

## Conséquences

- Chaque story visible ajoute ses parcours dans `apps/web/e2e/` ; chaque story API déclare ses routes et codes dans le contrat avant d'ajouter ses `*.contract.test.ts`.
- `shell-check.mjs` reste l'outil local des captures de revue design ; ses critères font foi en CI par Playwright.
- Hors périmètre : l'installation par le système (iOS / Android réels, protocole US-026) ; l'axe WCAG et la régression visuelle (US-044) ; les parcours dorés PA / PY inter-modules (US-047) ; le site dans la pile compose (report US-035).
- Coût CI : un job d'environ 3 à 5 minutes (installation, build, une soixantaine de parcours en parallèle).

## Alternatives écartées

- **Chromium de Playwright** (`playwright install`) : téléchargement d'un binaire à chaque run, hors du lockfile ; le Chrome du runner suffit.
- **Émulation de `display-mode`** par `Emulation.setEmulatedMedia` : ignorée par Chrome (mesuré).
- **Installation par le domaine CDP `PWA`** (`PWA.install` / `PWA.launch`) : la fenêtre lancée garde `display-mode: browser` sans interface, et l'installation échoue par intermittence (`kWriteDataFailed`) sous Windows.
- **Attendre US-038** pour l'OpenAPI : laisserait le critère 1 sans preuve ; l'amorce est remplaçable sans toucher au harnais.
- **Outils de contrat tiers** (Dredd, Schemathesis) : dépendances lourdes ou hors de l'écosystème Node ; Ajv seul suffit et reste strict.
