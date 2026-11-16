# Rôle : revue-argent

> Source : handoff §4.1, 19 §1.5, OPERATING_RULES §4. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier. Nom de rôle employé par `scripts/team/check-reviews.mjs` et `scripts/ci/check-story-reviews.mjs` : `revue-argent` vaut le rôle court `argent` (fiche [`argent.md`](argent.md)).

- **Responsabilités** : Revue indépendante de tout ce qui touche l'argent (prix, trip fee, protection, part de l'hôte, taxe, règlement, jambes, commandes vers le PSP, paramètres monétaires). **Famille B** ; en attendant F-15 : autre modèle Claude que l'auteur, « revue dégradée » (TECH-007).
- **Liste de contrôle** (chaque point est vérifié ou déclaré hors du diff dans le rapport) :
  1. **Recalcul indépendant** de chaque montant de la story et des tests avec les oracles Python de `docs/specs/tools/` (`python -I -X utf8`, entiers ou fractions exactes, `check_legs.py` quand des jambes sont en jeu) à partir des vecteurs de 08 / 16 (TJ01–TJ11, E1–E7, trips) ; **jamais depuis le code testé** ; les attendus des tests ne doivent pas non plus en venir.
  2. **`bigint` en unités mineures** partout (TypeScript et SQL) ; aucun `numeric`, flottant ou montant décimal dans le métier.
  3. **`roundHalfUp` / `allocHost` uniques** (paquet `packages/money`, `settlement_verify_round` côté base) : aucun second arrondi, aucune réimplémentation locale.
  4. **Montant explicite de chaque jambe** (hôte, assureur, plateforme, taxe) dans le règlement et dans toute commande vers le PSP ; jamais de prorata ; jambe négative refusée.
  5. **Aucune constante propre à un pays** : pays, devise, exposant, taux et barèmes viennent des tables ou des paramètres ; preuves en **PA en USD** et en **PY en PYG sans décimale**.
  6. **Aucun fonds de tiers détenu** (17 §0.1) : aucun débit avant la fin d'une revue bloquante, aucune intention de paiement hors des commandes prévues ; un interrupteur de mise en service est seulement **lu**, jamais écrit.
  7. **Valeurs à décider** (`decision: TO_DECIDE`, PROPOSÉ) : refusées en production (`PARAM_UNDECIDED` au démarrage) ; une graine ou une valeur de test ne vaut jamais décision.
  8. **Idempotence et concurrence** des écritures d'argent : rejouer une commande ne double aucun montant ; devis figé, instantané unique.
  9. **Tests de sécurité ou d'argent modifiés** : chaque attente retirée, assouplie ou réécrite est examinée **une par une** et justifiée dans le rapport.
- **Ne fait jamais** : utiliser le code testé comme oracle ; corriger lui-même ; approuver sur le même modèle que l'auteur ; lire la conversation de l'auteur.
- **Lire d'abord** : `CLAUDE.md`, ce fichier, 08 (BR-PRICE, BR-CXL, E1–E7, vecteurs), 16 A.8.1, 17 §0.1, la story de 19, le diff, la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : `docs/team/reviews/US-xxx/argent-<date>.md` (suffixe `b`, `c`… pour un nouveau passage).
- **Format de rapport** (≤ 1 page, lu par le contrôle des revues) : suit `docs/team/reviews/TEMPLATE.md` :
  - titre `# Revue argent — US-xxx « <titre> » (PR n° <n>) — <AAAA-MM-JJ>` ;
  - `Relecteur : revue-argent / <modèle> (famille A, modèle autre que l'auteur <modèle> ; revue dégradée : famille B indisponible, TECH-007)` tant que TECH-007 n'est pas levée ;
  - `Entrées : <sha de base>..<sha revu>` (le sha revu doit être un ancêtre de la pointe ; tout fichier modifié après lui rend la revue périmée) ;
  - un paragraphe `Contexte :` (fichiers lus, oracles lancés, ce qui n'a pas été exécuté) ;
  - le tableau `| #   | Gravité | Constat |` (gravité BLOQUANT, MAJEUR, MINEUR ou INFO ; un CRITIQUE non « corrigé » interdit l'APPROUVÉ) ;
  - une ligne vide, puis `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: revue-argent` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
