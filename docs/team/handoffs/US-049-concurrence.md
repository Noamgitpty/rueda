# Passation US-049 — red team « concurrence » (2026-11-05, agent red team, claude-sonnet-5-5)

Branche `story/US-049-redteam-concurrence`, worktree `../wt/US-049-concurrence`, PR en brouillon. Revue dégradée TECH-007 : code écrit par Opus, attaques écrites par Sonnet (famille B indisponible).

- **Fait** : attaques exécutées en CI (jamais en local : PostgreSQL local interdit), rapport `docs/team/redteam/L0-concurrence.md` (constats, parades, scénarios seulement lus).
- **Où sont les tests** :
  - `packages/db/test/redteam/concurrence/` (3 fichiers, groupe vitest `l0-redteam` ajouté à `packages/db/vitest.l0.config.ts`, exécuté seul après tous les autres fichiers de `test:l0`) ;
  - `apps/api/src/modules/pay/testing/redteam/` (webhooks FAKE et C19 sur base réelle : `test:int` ; contenu de l'image : `test:unit`). Placés dans le module PAY pour respecter la règle `rueda/module-boundaries`.
- **Règle de lecture** : un test rouge est une faille trouvée, il n'est ni masqué ni `skip`. Voir le rapport pour la gravité PROPOSÉE et la parade.
- **Non fait** : construction réelle de l'image (pas de Docker local ; le job CI « déploiement local » la rejoue) ; commandes `cmd_request_go_live_switch` / `cmd_approve_go_live_switch` (US-125) absentes du dépôt, donc le chemin « deux personnes » ne peut pas être exercé.
- **Reprise** : si un constat est corrigé, relancer `pnpm test:l0` et `pnpm test:int` ; mettre à jour la liste de fonctions « go live » de RT-CONC-23 quand US-125 livrera les commandes.
