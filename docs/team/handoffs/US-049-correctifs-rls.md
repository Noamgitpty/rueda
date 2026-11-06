# Passation US-049 (correctifs RLS) — failles de la red team RLS de la porte du lot 0 (2026-11-05, back-end, claude-opus-5-5)

- **Fait** : branche `story/US-049-correctifs-rls`, partie de `story/US-049-redteam-rls` (PR n° 88), à laquelle `main` est fusionnée. Elle remplace fonctionnellement la PR n° 88 : elle porte les tests de la red team inchangés et leurs correctifs. Statut de chaque constat : `docs/team/redteam/L0-rls.md` (« Statut des constats après correction ») ; décision : ADR-089.
  - **F-RLS-01** corrigé : migration `0056_booking_vehicle_ownership_guards.sql`. Blocage et levée exigent un véhicule du compte et du pays de la session selon `core.booking_vehicle_party` ; un véhicule inconnu est refusé. La clé étrangère vers `catalog_vehicle` viendra avec US-115 (la table n'existe pas encore).
  - **F-RLS-02** corrigé : même migration. Aucun membre `ACTIVE` ou `INVITED` du compte d'hôte ne pose de hold sur un véhicule de ce compte.
  - **F-RLS-03** non fermé, **décision de l'orchestrateur attendue** : analyse, risque résiduel et proposition (story du lot 4, avec le contexte signé de 17 §2.3) dans ADR-089. Parade compensatoire : la règle de lint `rueda/no-dynamic-sql`.
  - **F-RLS-04** corrigé : `packages/db/bootstrap/0000_instance_roles.sql` § 3.
  - **F-RLS-05** corrigé : `l0-us043-authorization-matrix` publie son propre actif de marque.
  - **F-RLS-06** (trouvé en CI sur RT-RLS-16) corrigé par la migration `0057_audit_worker_name_scope.sql` : clés de sujet réservées à `evidence_ingest`, `evidence_verifier`, `privacy_request` ; journal d'audit, journal d'accès et registre des fichiers réservés aux travailleurs de la matrice (deux noms PROPOSÉS ajoutés à `authorization-matrix.json`) ; les politiques du bus sont laissées telles quelles, avec leur justification dans ADR-089. Tests d'audit (`l0-aud-01`, `l0-aud-02`, `l0-us046`) : écrivain `audit_test_writer` remplacé par `privacy_request`.
  - **RT-CONC-02 « fin infinie »** (red team concurrence, fusionnée ici depuis `origin/story/US-049-redteam-concurrence` à `313d36e`, sans rebase) corrigé dans 0056 : bornes finies et durée ≤ `max_trip_days` du pays (paramètre existant, 30 j, 17 §7.2) pour le hold ; bornes finies pour le blocage. RT-CONC-53 et RT-CONC-58 (webhooks) sont confiés à l'agent argent et **restent rouges sur cette branche** : `test:int` s'arrêtant au premier échec, `test:l0` ne tourne pas tant qu'ils sont rouges dans le job « base de données ».
- **Revues de la PR n° 92 (SHA 8296c10)** traitées sur cette branche :
  - quarantaine d'horodatage blanchie et RC-5 hors WEBHOOK : migration `0058_payment_proof_hardening.sql` (colonnes `received_by_command`, `signed_at_out_of_tolerance` non effaçables ; MANUAL_OPS terminal refusé ; voie directe fermée) ; TS : `inWindow` sur l'indicateur, `mark()` ne remplace plus le motif, `UNPROVEN` ⇒ FAILED `PROOF_REJECTED` et alerte ; RC-5 **partiellement corrigée** (POLL, API_RESPONSE : US-223, caractérisation) ;
  - tests négatifs de la preuve (`l0-us049-payment-proof`, PA et PY) ; RC-2 fractionné et concurrent (`l0-us049-money-fixes`) ; F-RLS-01 pays croisé et levée isolée (`l0-us049-rls-fixes`) ; enchaînement de quarantaine et `UNPROVEN` (`webhook-processor.test.ts`) ; vecteur T27 corrigé (`record.golden.test.ts`) ;
  - `no-dynamic-sql` : accès calculé, `.call` / `.apply`, alias, étiquettes inconnues ; exception unique comptée par un test ;
  - F-RLS-04 : `pg_notify` retirée, sonde du job de déploiement ;
  - RC-3 : plafond du versement par la jambe retenue non posable au lot 0 (aucun règlement de trajet terminé), limite écrite, story US-125 ; `release_at` sans écrivain ;
  - en-têtes de 0056 et 0057 (« resserrement de comportement ») ; ADR-057 « amendé par ADR-088 » ; ADR-088 « précise ADR-009 » ;
  - l'aide `receiveProof` (`test/support/avl.ts`) passe par le vrai webhook signé : la voie directe qu'elle utilisait est fermée par 0058.
- **Tests** : nouveau `packages/db/test/l0/l0-us049-rls-fixes.test.ts` (PA, PY ; base de test et base de production du banc ; `app_api`, `app_worker`, `app_anon`) et `packages/config/test/no-dynamic-sql.test.ts`. Tests existants modifiés, avec leur justification :
  - `l0-occ-single-occupancy` : enregistre au registre de test les véhicules neufs qu'il bloque, comme les holds depuis US-023, et prouve le refus d'un véhicule de B inoccupé et d'un UUID inconnu (PA, PY) ;
  - `iam-schema` : nouvelle politique `cmd_hold_read` sur `iam_membership` ;
  - `support/expiry-2a.test.ts` : l'instruction 2a est aussi vérifiée dans 0056 ;
  - `l0-us043-authorization-matrix` : correction de F-RLS-05.

  **Aucun test de la red team RLS ni concurrence n'a été modifié par ces correctifs.** La fusion des correctifs argent (#91) a, elle, modifié deux aides de tests de red team (`succeeded()` de `redteam-argent-psp-legs`, `applySucceeded` de `rt-conc-02-conversion` : webhook signé réel avant le statut) et inversé ARG-34a en caractérisation, sans affaiblir d'assertion (justifié dans `L0-argent.md`). PostgreSQL local n'a jamais été démarré : la CI fait foi. `pnpm lint`, `pnpm typecheck` et les tests unitaires de `@rueda/db` et `@rueda/config` sont verts en local.

- **Reste** :
  - vérifier en CI que RT-RLS-13 et RT-RLS-17 passent au vert et que le reste ne régresse pas ;
  - obtenir les revues exigées pour US-049 (code, architecture, sécurité, argent ; RLS et `SECURITY DEFINER` sur un autre modèle) ;
  - faire décider F-RLS-03 par l'orchestrateur ;
  - fermer la PR n° 88 au profit de celle-ci ;
  - fusionner d'abord `docs/team/review-requirements.json`, qui ajoute US-049 à `pathOwners` de `packages/db/` et `packages/config/`. Ce fichier est lu sur la base : la revue sécurité est exigée.
- **Prochaine commande exacte** : `pnpm --filter @rueda/db test:l0 -- redteam-rls l0-us049 l0-occ l0-us043` (CI seulement).
- **Pièges / hypothèses** :
  - **Numérotation** : `story/US-049-correctifs-argent` (PR n° 91) a pris les migrations 0054 et 0055 et l'ADR-088. Elle est fusionnée ici (175aa1d) : la migration de cette branche est **0056** et l'ADR **089**. Les références sont mises à jour dans `expiry-2a.test.ts`, `schema.md`, le README de `@rueda/db`, ADR-089 et les rapports.
  - En production, plus **aucun blocage** n'est possible avant le catalogue (US-115), comme aucun hold : c'est le fail-closed voulu.
  - Sur un service PostgreSQL géré, l'amorçage peut ne pas pouvoir retirer les fonctions de `pg_catalog`. Il émet alors un avertissement : à vérifier au premier déploiement réel (US-003).
- **Paramètres créés (17 §7.2)** : aucun. **Entités / migrations** : 0056 (remplacement de trois corps de commandes, un droit et une politique pour `cmd_hold_owner`). **Décisions** : ADR-089 (PROPOSÉ).
