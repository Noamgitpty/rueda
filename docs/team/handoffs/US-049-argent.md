# Passation US-049 — red team « argent » (2026-11-06, agent red team, claude-sonnet-5-5)

Branche `story/US-049-redteam-argent`, worktree `../wt/US-049-argent`, PR en brouillon. **Statut : EN REVUE.** Revue dégradée TECH-007 (Sonnet contre du code Opus). Revues exigées pour US-049 (`review-requirements.json`) : code, architecture, sécurité, argent. Aucune migration, aucun code de production modifié.

- **Fait** : 121 tests d'attaque dans `packages/db/test/l0/redteam-argent-{engine,settlement,psp-legs}.test.ts` (sous les rôles de production, USD et PYG), rapport de constats `docs/team/redteam/L0-argent.md`, fragment `changelog.d/US-049-redteam-argent.md`. 21 scénarios : 16 bloqués, 5 avec faille (9 attaques, 5 racines RC-1 à RC-5).
- **Les tests rouges sont des constats, pas des bogues du banc** : 16 tests (RC-1 à RC-5) restent rouges dans le job « base de données » tant que les parades ne sont pas livrées. Ne pas les marquer `skip`.
- **Reste (orchestrateur)** :
  1. Verser RC-1 à RC-5 au tableau (`BOARD.md`) en bogues / stories avec leur gravité proposée ; RC-1, RC-2 et RC-3 (élevées) bloquent la porte du lot 0 selon le critère 5 de US-049 (« aucun constat critique ou élevé n'est ouvert ») jusqu'à correction ou décision écrite du fondateur.
  2. Second passage famille B sur les mêmes scénarios (revue dégradée).
  3. Si `check-story-reviews` échoue sur `packages/db/` : `docs/team/review-requirements.json` (`pathOwners["packages/db/"]`) ne liste pas US-049 ; les règles sont lues sur la base, la correction doit partir de `main` (revue sécurité exigée pour ce fichier).
- **Pièges** : `app_anon` n'a pas accès à `platform.now()` ; `withTestTransaction` ne convient donc pas à ce rôle. Les tests de course (ARG-21) committent un trip et ses soldes capturés, comme L0 EC-54 existant ; ils n'ont pas besoin du groupe isolé (6 connexions). Le fichier `engine` n'ouvre qu'une connexion pour l'assertion L0-05.
- **Paramètres créés (17 §7.2)** : aucun. **Entités / migrations** : aucune. **Décisions** : aucune (gravités PROPOSÉES).
