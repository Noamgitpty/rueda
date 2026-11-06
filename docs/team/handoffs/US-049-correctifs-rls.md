# Passation US-049 (correctifs RLS) — failles de la red team RLS de la porte du lot 0 (2026-11-05, back-end, claude-opus-5-5)

- **Fait** : branche `story/US-049-correctifs-rls`, partie de `story/US-049-redteam-rls` (PR n° 88), à laquelle `main` est fusionnée. Elle remplace fonctionnellement la PR n° 88 : elle porte les tests de la red team inchangés et leurs correctifs. Statut de chaque constat : `docs/team/redteam/L0-rls.md` (« Statut des constats après correction ») ; décision : ADR-088.
  - **F-RLS-01** corrigé : migration `0054_booking_vehicle_ownership_guards.sql`. Blocage et levée exigent un véhicule du compte et du pays de la session selon `core.booking_vehicle_party` ; un véhicule inconnu est refusé. La clé étrangère vers `catalog_vehicle` viendra avec US-115 (la table n'existe pas encore).
  - **F-RLS-02** corrigé : même migration. Aucun membre `ACTIVE` ou `INVITED` du compte d'hôte ne pose de hold sur un véhicule de ce compte.
  - **F-RLS-03** non fermé, **décision de l'orchestrateur attendue** : analyse, risque résiduel et proposition (story du lot 4, avec le contexte signé de 17 §2.3) dans ADR-088. Parade compensatoire : la règle de lint `rueda/no-dynamic-sql`.
  - **F-RLS-04** corrigé : `packages/db/bootstrap/0000_instance_roles.sql` § 3.
  - **F-RLS-05** corrigé : `l0-us043-authorization-matrix` publie son propre actif de marque.
- **Tests** : nouveau `packages/db/test/l0/l0-us049-rls-fixes.test.ts` (PA, PY ; base de test et base de production du banc ; `app_api`, `app_worker`, `app_anon`) et `packages/config/test/no-dynamic-sql.test.ts`. Tests existants modifiés, avec leur justification :
  - `l0-occ-single-occupancy` : enregistre au registre de test les véhicules neufs qu'il bloque, comme les holds depuis US-023, et prouve le refus d'un véhicule de B inoccupé et d'un UUID inconnu (PA, PY) ;
  - `iam-schema` : nouvelle politique `cmd_hold_read` sur `iam_membership` ;
  - `support/expiry-2a.test.ts` : l'instruction 2a est aussi vérifiée dans 0054 ;
  - `l0-us043-authorization-matrix` : correction de F-RLS-05.

  **Aucun test de la red team n'a été modifié.** PostgreSQL local n'a jamais été démarré : la CI fait foi. `pnpm lint`, `pnpm typecheck` et les tests unitaires de `@rueda/db` et `@rueda/config` sont verts en local.

- **Reste** :
  - vérifier en CI que RT-RLS-13 et RT-RLS-17 passent au vert et que le reste ne régresse pas ;
  - obtenir les revues exigées pour US-049 (code, architecture, sécurité, argent ; RLS et `SECURITY DEFINER` sur un autre modèle) ;
  - faire décider F-RLS-03 par l'orchestrateur ;
  - fermer la PR n° 88 au profit de celle-ci ;
  - fusionner d'abord `docs/team/review-requirements.json`, qui ajoute US-049 à `pathOwners` de `packages/db/` et `packages/config/`. Ce fichier est lu sur la base : la revue sécurité est exigée.
- **Prochaine commande exacte** : `pnpm --filter @rueda/db test:l0 -- redteam-rls l0-us049 l0-occ l0-us043` (CI seulement).
- **Pièges / hypothèses** :
  - **Numérotation** : 0054 et ADR-088 sont pris sans connaître ceux de `story/US-049-correctifs-argent`, absente d'origin au moment du choix. En cas de collision, la seconde PR fusionnée renumérote. Les migrations sont contiguës (`numbering.test.ts`) ; le nom 0054 est cité dans `expiry-2a.test.ts`, `docs/architecture/schema.md`, le README de `@rueda/db` et ADR-088.
  - En production, plus **aucun blocage** n'est possible avant le catalogue (US-115), comme aucun hold : c'est le fail-closed voulu.
  - Sur un service PostgreSQL géré, l'amorçage peut ne pas pouvoir retirer les fonctions de `pg_catalog`. Il émet alors un avertissement : à vérifier au premier déploiement réel (US-003).
- **Paramètres créés (17 §7.2)** : aucun. **Entités / migrations** : 0054 (remplacement de trois corps de commandes, un droit et une politique pour `cmd_hold_owner`). **Décisions** : ADR-088 (PROPOSÉ).
