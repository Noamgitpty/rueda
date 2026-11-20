# Revue securite (delta) — US-315 « remise et retour entre particuliers » (PR n° 270) — 2026-11-19b

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5; revue dégradée : famille B indisponible, TECH-007)
Entrées : d2376472..64359305

Contexte : Revue delta de `d2376472..64359305` (rapport précédent : `securite-2026-11-19.md`). CI relue au SHA 64359305 : entièrement verte (run 44649482746) ; PostgreSQL et Docker non démarrés, les preuves L0 sont lues, non rejouées. `.github/`, `scripts/ci/`, `scripts/team/` et `review-requirements.json` non touchés ; aucun secret. Migration 0163 delta, vue `guest`, fonctions `SECURITY DEFINER` modifiées, allowlist, fake de test.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                               |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **Aucune régression.** Les trois commandes et la vue gardent `search_path = pg_catalog, pg_temp`, propriétaire, `REVOKE` / `EXECUTE` et allowlist ; verrous pris avant toute lecture d'état ou d'heure ; conditions relues en base ; restriction jamais nommée ; aucune écriture d'argent ni de `release_at`.                                         |
| 2   | INFO    | **Correction 4 : minimisation.** Prénom, initiale et année de naissance ne sont lus et servis à l'hôte qu'en CHECKIN_OPEN / START_WINDOW_EXPIRED ; ni avant l'ouverture, ni après le départ, ni sur un trip annulé ou terminé ; le voyageur ne reçoit rien. L0 et contrat le prouvent.                                                                |
| 3   | INFO    | **Pièce d'identité.** Aucune image ni numéro de licence n'est servi à l'hôte. La case « ressemble à la photo du permis » renvoie à la photo imprimée sur la licence physique tendue par le voyageur ; l'en-tête (« Compare le permis physique du voyageur… Ne le photographie pas ») le dit clairement dans les 4 langues. Rien de plus n'est exposé. |

Verdict : APPROUVÉ
