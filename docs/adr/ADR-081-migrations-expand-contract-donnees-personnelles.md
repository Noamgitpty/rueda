# ADR-081 — Migrations testées une par une sur base peuplée, expand / contract imposé, inventaire des données personnelles

- **Statut** : PROPOSÉ (US-046, agent back-end, claude-opus-5-5, 2026-11-04). Revues exigées : code, architecture, sécurité et QA (story ; `packages/db/`), sur un autre modèle que l'auteur. À reporter dans 17 §8.1 (journal des ADR), §11 (RLS-19) et §12 (portes CI).
- **Sources** : 19 US-046 et §1.8 (lignes « Migrations » et « Données personnelles ») ; 17 §2.3, §3.1.3, §3.1.4, §11 (L0-05, RLS-19, B9) ; 08 BR-ACC-09 ; ADR-026 (crypto-shredding), ADR-051, ADR-077 (matrice d'autorisations), ADR-078 point 6 (expand / contract, retour arrière sans migration descendante), ADR-079 (schéma généré).

## Contexte

Le critère de 19 demande qu'une migration « monte puis descende » sur les graines PA et PY à comptes et intégrité égaux, et que l'export et l'effacement des données d'une personne soient vérifiés. Le projet a choisi (ADR-078, US-003) un retour arrière **sans migration descendante** : la version N doit tourner sur le schéma N + 1. Cette règle était écrite (`docs/ops/DEPLOY.md`) mais rien ne l'imposait. Le banc appliquait toutes les migrations d'un coup sur une base vide : une migration qui échoue sur une table peuplée ne se voyait pas. Aucune liste ne disait quelles colonnes portent une donnée personnelle.

## Décision

1. **« Descente » = retour arrière d'US-003.** On ne crée pas de migrations descendantes (ADR-078). La descente se prouve en vérifiant qu'après la migration N + 1, tout ce que la version N utilise existe encore à l'identique.
2. **Lint `sql-expand-contract`** (`packages/db/src/expand-contract/`, dans `pnpm lint` et `pnpm lint:sql`). Il analyse les instructions de premier niveau des migrations de production : commentaires, chaînes et corps de fonctions sont masqués, le corps d'un bloc `DO` est analysé. Il refuse onze contractions :
   - suppression d'une table, d'une vue, d'une séquence, d'un type ou d'un schéma ;
   - suppression d'une fonction, suppression d'une colonne ;
   - renommage ;
   - changement de type ;
   - `SET NOT NULL` ;
   - colonne `NOT NULL` sans défaut ;
   - retrait d'un droit d'`app_api`, `app_worker` ou `app_anon` ;
   - `TRUNCATE`, `DELETE` ou `UPDATE` de premier niveau.

   Une contraction n'est admise que par une **dérogation** de `packages/db/expand-contract-allowlist.json` : fichier, ligne, nature, justification d'au moins 40 caractères. Une dérogation périmée fait échouer le lint. Les sept contractions historiques (0032 à 0044) y sont justifiées : elles ont été écrites avant la règle, alors qu'aucune version n'était servie.

3. **Test des migrations une par une** (`test/l0/l0-us046-migrations.test.ts`). Le banc crée une cinquième base, `rueda_test_<aléa>_mig`, amorcée **sans** migration. Seul ce test la touche, sous `migrator` (`connectMigratorForMigrationTest`, réservé à cette base ; jamais SUPERUSER ni BYPASSRLS). Pour chaque migration, dans l'ordre :
   - application **seule**, par l'option `through` de `runMigrations` ;
   - comparaison des catalogues avant et après (relations, colonnes, types, nullabilité, fonctions, droits des rôles applicatifs). Tout écart doit être couvert par une dérogation du même fichier ;
   - comparaison des données : comptes, et empreinte de chaque ligne existante sur ses colonnes d'avant. Des lignes ne peuvent apparaître qu'avec un `INSERT` de premier niveau sur la table, et seule une migration de données déclarée (`dataTables`) peut réécrire des lignes ;
   - contrôles d'intégrité : aucune contrainte `NOT VALID` (PostgreSQL contrôle les lignes existantes à l’ajout d’un `CHECK` ou d’une FK), aucune clé étrangère orpheline, RLS `ENABLE` + `FORCE` et lecture complète de `migrator` sur chaque table (RLS-19, B9) ;
   - pose des graines (`test/support/migration-seeds.ts`), dès que leurs tables existent. Ce sont des personnes, comptes d'hôte, sessions, événements, clés de sujet, lignes d'audit chaînées, journal d'accès, fichier chiffré, dossier de support, notifications, occupations, trip et hold, en PA et en PY. `migrator`, sous RLS forcée, doit voir exactement les lignes posées (RLS-19).

   À la fin du parcours, la chaîne d'audit doit être valide et un second passage ne doit rien appliquer. L'exécuteur doit aussi refuser une migration appliquée modifiée, absente ou renommée. Une migration rejouée sous un numéro neuf doit échouer et être annulée en entier. Une dérogation `populated: false` (0032, 0038) déclare une migration qui exigeait des tables vides : les graines de ces tables ne sont posées qu'après elle.

4. **Inventaire des données personnelles** (`packages/db/personal-data-inventory.json`). Il couvre chaque colonne de chaque table de production : 65 tables et 776 colonnes. Chaque colonne reçoit une classe (C0 à C4). Chaque table reçoit sa classe de suppression (17 §3.1.3), ses colonnes de sujet et son canal d'export. Chaque colonne C2 / C3 reçoit sa méthode d'effacement : `crypto-shredding`, `pseudonymisation`, `purge`, ou `derogation` (justification et story de report obligatoires). Contrôles :
   - **complétude** : unitaire contre `docs/architecture/schema.md` (généré par la CI), et L0 contre le catalogue de production. Une colonne nouvelle non classée fait échouer les deux ;
   - **règles** : pas de pseudonymisation dans un registre immuable (A) ; une colonne en crypto-shredding est un `bytea` `_enc` avec ses colonnes de clé ; un C4 est haché, enveloppé ou référencé ; dans une table de sujet, un nom de donnée personnelle ne peut pas être classé C0 ou C1 ;
   - **cohérence avec la matrice d'US-043** :
     - aucune colonne C2 à C4 n'est lisible par `app_anon` ;
     - aucune C3, ni aucune C4 sans `apiRead` justifié, n'est lisible par `app_api` ;
     - aucune table à C2 n'est lisible « tout » par un voyageur ou un hôte ;
     - l'export `self` correspond exactement aux tables qu'une personne lit d'elle-même.
5. **Export en libre-service** (`exportOwnPersonalData`, BR-ACC-09). Il tourne dans la session de la personne, sous `app_api`, et la RLS fait foi. Il couvre chaque table `self`, avec les colonnes que la matrice accorde à `app_api`, sauf les C4. Les données que la personne ne lit pas elle-même relèvent de l'export par le responsable des données (`controller`, US-536).
6. **Effacement piloté par l'inventaire.** Pour chaque colonne et chaque contenu de fichier en crypto-shredding, la destruction de la clé du sujet doit rendre ses octets illisibles, sans changer les octets, les comptes ni la chaîne d'audit. Le sujet de l'autre pays doit rester lisible.
7. **Aucune donnée personnelle dans les URL, journaux, alertes et erreurs** (`apps/api/src/testing/personal-data-leaks.test.ts`) :
   - aucun paramètre de chemin ni de requête du contrat ne porte de donnée personnelle ;
   - une analyse statique (compilateur TypeScript) vérifie qu'aucun appel de journal, d'alerte ni aucune construction d'erreur du code de production ne reçoit un nom de colonne C2 à C4 de l'inventaire, un corps, un en-tête ou un cookie ;
   - l'application réelle est exécutée (inscription, connexion, vérification, erreur PostgreSQL portant la donnée dans `detail`) : rien ne fuit dans les réponses ni dans le journal.

## Défauts PROPOSÉS (fail-closed, 22)

- Classe des motifs libres (`reason`, `purpose`) : **C2**. Dans les registres en ajout seul (`audit_log.reason`, `data_access_log.purpose`, `finance_approval.reason`), ils ne peuvent être ni pseudonymisés ni détruits par clé : ils sont inscrits en **dérogation** avec report à US-536. Consigne : aucune donnée d'une personne dans un motif.
- Variables de notification : **C2**, effacées par purge (rétention courte). En-têtes de webhook : **C1** (en-têtes du PSP, masqués des PAN).
- `iam_organization.tax_id` : **C2**, selon l'annotation de la migration 0010. S'il passait en C3 (n° de pièce, 17 §3.1.4), la cohérence avec la matrice échouerait : `app_api` le lit.

## Limites

- L'analyse statique des journaux se fait par **nom**. Elle ne suit pas une valeur à travers des variables intermédiaires. Les noms trop génériques (`key`, `reason`, `purpose`, `variables`) sont exclus : leur contenu est couvert par l'inventaire et par la revue.
- Graines sans PAY ni STL : le compte FAKE exige un environnement déclaré, et les quatre jambes ont leurs propres preuves L0 (US-019, US-023, US-056). Leurs tables sont vides dans le parcours, mais leurs contrôles de schéma, de droits, d'intégrité et de RLS-19 s'appliquent.
- La pseudonymisation des colonnes C2 des tables B (compte, organisation, sessions) et la purge par rétention ne sont pas encore codées : l'inventaire déclare la méthode, l'outil arrive avec US-536.
- La perte d'une **politique** RLS d'un rôle applicatif n'est pas une contraction détectée : seuls les droits (GRANT) le sont. La matrice d'US-043 couvre les politiques.

## Conséquences

- Une migration qui supprime, renomme, retype, rend obligatoire, retire un droit, ou réécrit ou supprime des données échoue au lint, sauf dérogation revue (architecture, et sécurité si un droit est retiré). Elle échoue aussi au test L0 si elle casse la version N, perd ou altère une ligne, ou échoue sur une base peuplée.
- Une colonne ajoutée par une migration doit être classée dans l'inventaire dans la même story. Les deux tests de complétude échouent sinon.
- Toute story qui ajoute une graine réaliste peut l'ajouter à `migration-seeds.ts`. Les migrations suivantes seront alors prouvées sur ces données.
