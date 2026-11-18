# Revue architecture — US-019 « correctif : détecteur de PAN et empreintes hex(sha256) » (PR n° 219) — 2026-11-17

Relecteur : architecture / claude-sonnet-5-5 (famille A, autre modèle que l'auteur claude-opus-5-5)
Entrées : 3187c948..18a8ff8278e596070ce70fa326f07d2fbd47c803

Contexte : Lu : CLAUDE.md, fiches de revue, ADR-155, passation US-019, 0028, 0029, 0131 (diff de la fonction contre 0029 : seule l'étape 1 et le commentaire changent), pan.ts, vecteurs et tests. CI du run 44171328704 au SHA revu : base de données (test:int, test:l0 sous app_worker), qualité, argent, revues, gitleaks verts ; seul e2e web échoue (capture S01 de l'accueil, instabilité N-180 connue : la PR ne touche aucun fichier web), rien relancé. Sondes locales rejouées sur pan.ts ; PostgreSQL non démarré en local : le SQL est prouvé par la CI. Chemins protégés (.github, scripts/ci, scripts/team, review-requirements.json) : non touchés.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                         | Preuve           | Décision |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------- |
| 1   | INFO    | Décision cohérente avec ADR-059 : corriger le détecteur (b) plutôt que modifier 08 E4 / 17 §2.8 par une story ; migration additive (`CREATE OR REPLACE`), aucun nouvel objet, paramètre ni allowlist ; miroir API sans nouvel import inter-module (pan.ts reste interne à pay). | ADR-155 ; diff   | accepté  |
| 2   | INFO    | Définition unique en deux lieux (base et API) tenue par des vecteurs partagés (JSON commun) ; l'alternative (a) reste tracée comme reprise possible avec demande de fusion de specs ; report 17 §4.4 point 3 différé de façon explicite, acceptable.                            | pan-vectors.json | accepté  |

Verdict : APPROUVÉ
