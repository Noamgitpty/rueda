# Revue securite — US-221 « parcours dorés réservation PA / USD et PY / PYG » (PR n° 245) — 2026-11-18 (delta 2)

Relecteur : revue-securite / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5; revue dégradée : famille B indisponible, TECH-007)
Entrées : 69905857..b11aba65 (SHA revu : b11aba65)

Contexte : delta `git diff 69905857 b11aba65` relu (`apps/api/test/int/parcours-dores-reservation.int.test.ts`, 10 lignes ajoutées, 4 retirées), comparé avec `git diff -w` ; revues précédentes APPROUVÉ aux SHA 02b5910b et e33c943a (`securite-2026-11-18.md`, `securite-2026-11-18b.md`) reprises pour le reste. Aucune base ni Docker démarrés ici.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **Assertions inchangées** : le delta ne touche aucune assertion ; `firstProvider` reçoit la connexion en paramètre et `onFakeAccount` en ouvre une seule (`open('app_worker')`, rôle de production, assertion L0-05 de `connectAs`) pour toute l'attente, libérée par l'`afterEach` existant : plus une connexion par lecture (cause du run 44395485499).                                                           |
| 2   | INFO    | **Écriture validée du delta** : un seul appel de fixture (`SECURITY DEFINER` de test, propriétaire migrator, base de test) qui crée un compte FAKE de SANDBOX avec des références de secrets fictives (`vault:psp/test/...`) ; aucun identifiant réel, aucun secret, aucun interrupteur (17 §0.1), aucun rôle ni droit ajouté. Le compte FAKE est inactif en production (fixture de test non migrée en production). |

Verdict : APPROUVÉ
