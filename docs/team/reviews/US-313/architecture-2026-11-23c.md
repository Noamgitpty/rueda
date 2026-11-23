# Revue architecture (delta 2) — US-313 (suite de la red team du lot 3) (PR n° 296) — 2026-11-23

Relecteur : architecture / claude-opus-5-5 (famille A ; autre modèle que l'auteur claude-sonnet-5-5)
Entrées : 42dfead1ab064c9f2d84319cb07297d7046a8da4..578cff39b8a516d9cffcfcb4bc856798a7b8e391 (`git diff`, `git diff -w` et `git diff --word-diff`) ; cahier des charges : les cinq revues `*-2026-11-23b.md` ; `packages/db/test/l0/l0-us307-no-show.test.ts`, `l0-us318-p2p-claims.test.ts`, `l0-us709-chargebacks.test.ts`, `l0-us317-reviews.test.ts` ; CI du run 45114932514

**Revue précédente.**

- **N° 1 (MAJEUR, NS02) : corrigé.** Les quatre documents disent la même chose. La réaffectation refusée est prouvée par `l0-us307-no-show`. Le versement `ON_HOLD` n'est pas prouvé et doit être joué avant la porte. On le lit dans le rapport (`L3-donnees-sinistres.md:60`), l'index (`gates/L3/redteam.md:8`), la passation (`handoffs/US-313.md:42`) et le statut de L3-PM-19 (`RISKS.md:193`). L'attendu du plan (`premortem.md:289`, « capacité inconnue ⇒ versement `ON_HOLD` ») reste inchangé, ce qui est normal : c'est la cible de la preuve à jouer, et non une preuve.
- **N° 2 (raison du report de M01 à M03) : corrigé** (`L3-donnees-sinistres.md:61`). Le débit MIT, T68, les encaissements partiels et la caution relèvent d'US-703 et d'US-309, qui n'étaient pas assignées à cette passe.
- **N° 3 (L3-PM-34) : corrigé en partie**, voir le n° 1 ci-dessous.

**Sondage de trois renvois vers des tests existants** (tirés parmi les renvois du rapport) :

- `l0-us307-no-show` : le test de la capacité inconnue (`:591-601`) attend `FIN_REVIEW_REQUIRED` ;
- `l0-us709-chargebacks` : le contrôle FIN `CHARGEBACK_UNIMPUTED` est bien joué (`:406`) ;
- `l0-us318-p2p-claims` : le dossier de vol (`THEFT_INVESTIGATION`), le retour et la clôture sont joués au critère 1 (`:162`).

`l0-us317-reviews` existe aussi. Je ne trouve aucune autre affirmation de preuve inexacte.

**RISKS.md.** `git diff -w` ne change que trois lignes : le séparateur du tableau, élargi, L3-PM-19 et L3-PM-34. Les 124 lignes de `--stat` viennent du réalignement Prettier de la colonne. `--word-diff` le confirme : seuls ces deux statuts changent, et les deux restent `OUVERT`.

**CI au SHA 578cff39b8a516d9cffcfcb4bc856798a7b8e391** : le job « base de données » est vert, avec `3165 passed | 16 expected fail | 2 skipped`. Les 16 échecs attendus sont les 14 `it.fails` de cette passe et les 2 de F-L3-PRE-03. Les jobs « guide d'installation » et e2e sont également verts.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                             | Preuve (fichier:ligne, test)                       | Décision                                                                                |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | MINEUR  | **L3-PM-34 : seul RISKS.md est à jour.** Il dit maintenant « confirmé par la revue argent », mais sans la suite demandée : « part `HOST` du frais versée après encaissement ; test à jouer avant le post-mortem ». Le rapport, lui, garde l'ancienne formule : « la revue argent peut le relever ». | `RISKS.md` L3-PM-34 ; `L3-donnees-sinistres.md:36` | Non bloquant. Aligner les deux textes dans la passe de correctifs (N-xxx-F ou N-xxx-G). |

Verdict : APPROUVÉ
