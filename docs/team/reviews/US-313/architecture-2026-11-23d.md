# Revue architecture (mini-revue du merge de main) — US-313 (suite de la red team du lot 3) (PR n° 296) — 2026-11-23

Relecteur : architecture / claude-opus-5-5 (famille A ; autre modèle que l'auteur claude-sonnet-5-5)
Entrées : 23cc1709534c70ded0675b944731ff525f27735d..9454a5e0b8a6a4160ba829ae433f6b3f8228b7ce ; `git show --remerge-diff 9454a5e0` ; `git diff origin/main HEAD -- docs/team/RISKS.md` (`-w`, `--word-diff=porcelain`) ; comparaison ligne à ligne, espaces normalisés, des 60 lignes L3-PM entre la base de fusion 0e3fcd24, la branche 23cc1709, main 9f759e51 et 9454a5e0 ; `git diff --word-diff 23cc1709 9454a5e0 -- docs/team/redteam/L3-donnees-sinistres.md` ; `support-l3.ts:232`, `rt-l3-06-sinistres.test.ts:87` ; ADR-200 ; CI du run 45117633231

**Delta.** 9454a5e0 a deux parents : 23cc1709 (branche) et 9f759e51 (`origin/main`, à jour). `git show --remerge-diff` ne touche que deux fichiers : `docs/team/RISKS.md` (conflit résolu) et `docs/team/redteam/L3-donnees-sinistres.md` (deux retouches). Aucun autre fichier n'est modifié hors de ce qu'apporte main.

**RISKS.md.** La résolution part de main. Hors du tableau du lot 3 (`RISKS.md:171-236`), le fichier est identique à main, ligne pour ligne. Dans le tableau, `git diff -w origin/main HEAD` ne montre que le séparateur (réalignement Prettier) et les huit lignes L3-PM-19, 25, 26, 29, 34, 40, 49, 51. La comparaison à espaces normalisés le confirme :

- ces huit lignes sont celles de la branche, mot pour mot ;
- L3-PM-03 et L3-PM-06 sont celles de main (BOARD #294 : F-L3-PRE-01 / 02 corrigés), et non plus celles de la branche ;
- les 50 autres lignes sont identiques sur les trois côtés.

Entre la base de fusion et main, seules 03 et 06 avaient changé ; entre la base et la branche, seules les huit. Il n'y a donc aucun recouvrement, et rien n'est perdu.

**Retouches du rapport.**

- `L3-donnees-sinistres.md:36` (L3-PM-34) : « la revue argent peut le relever » devient « confirmé par la revue argent ; la part HOST est versée après encaissement ; test à jouer avant le post-mortem ». C'est exact : n° 7 de `argent-2026-11-23.md`, n° 3 de `argent-2026-11-23b.md`, n° 1 de `argent-2026-11-23c.md`, et ADR-200 critère 3.
- `L3-donnees-sinistres.md:65` (« Aides ») : la note ajoute que le `shoot` local de `rt-l3-06` double celui que `support-l3.ts` exporte déjà, avec une autre signature et d'autres valeurs de retour. C'est exact (`support-l3.ts:232` contre `rt-l3-06-sinistres.test.ts:87`).

**CI.** Run 45117633231 sur 9454a5e0 : tous les jobs sont verts, y compris `revues indépendantes`, base de données, e2e et fuzz.

Angle architecture : la résolution suit la règle « main d'abord » ; la documentation de main (BOARD #294, US-319 #297, US-050 #298) arrive intacte, hors du seul tableau L3 de `RISKS.md` où les huit statuts de la red team sont réappliqués. Le format du tableau reste celui de Prettier (colonnes réalignées).

| #   | Gravité | Constat                                                                                                                                                                                                                                                     | Preuve (fichier:ligne, test)                            | Décision                                            |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| 1   | MINEUR  | La ligne L3-PM-34 de `RISKS.md` ne porte que « confirmé par la revue argent ». La précision « part HOST versée après encaissement ; test avant le post-mortem » n'est que dans le rapport. Le statut reste `OUVERT`, et le rapport fait foi pour le détail. | `RISKS.md:210` ; `L3-donnees-sinistres.md:36`           | Non bloquant ; à reprendre au post-mortem du lot 3. |
| 2   | MINEUR  | La résolution réaligne tout le tableau L3 (Prettier) : le diff brut montre 62 lignes changées pour 8 statuts réels.                                                                                                                                         | `git diff --stat origin/main HEAD` contre `git diff -w` | Accepté (format imposé par le job qualité, vert).   |

Verdict : APPROUVÉ
