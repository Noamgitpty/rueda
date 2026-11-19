# Revue architecture — US-221 « parcours dorés réservation PA / USD et PY / PYG » (PR n° 245) — 2026-11-18 (delta 2)

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 69905857..b11aba65 (SHA revu : b11aba65)

Contexte : delta `git diff 69905857 b11aba65` relu (`apps/api/test/int/parcours-dores-reservation.int.test.ts`, 10 lignes ajoutées, 4 retirées), comparé avec `git diff -w` ; revues précédentes APPROUVÉ aux SHA 02b5910b et e33c943a (`architecture-2026-11-18.md`, `architecture-2026-11-18b.md`) reprises pour le reste. Aucune base ni Docker démarrés ici.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **Assertions inchangées** : le delta ne touche aucune assertion ; `firstProvider` reçoit la connexion en paramètre et `onFakeAccount` en ouvre une seule (`open('app_worker')`, rôle de production, assertion L0-05 de `connectAs`) pour toute l'attente, libérée par l'`afterEach` existant : plus une connexion par lecture (cause du run 44395485499). |
| 2   | INFO    | **Compte FAKE validé hors transaction** : `inTx(api, { commit: true }, ...)` appelle seulement `test_fixture.us024_psp_account(pays)`, fixture idempotente (relit le compte FAKE/SANDBOX ACTIVE existant, `ON CONFLICT DO NOTHING`), même motif que le segment B. Résout la réserve MINEUR de la revue précédente (dépendance à l'ordre des fichiers).    |

Verdict : APPROUVÉ
