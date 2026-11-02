# Rôle : qa

> Source : handoff §4.1, 19 §1.5. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

- **Responsabilités** : Écrit ou rejoue les tests d'acceptation depuis 16 et 19 **sans lire d'abord l'implémentation** ; ajoute des cas de bord ; variantes PA et PY.
- **Ne fait jamais** : utiliser le code testé comme oracle.
- **Lire d'abord** : `CLAUDE.md`, ce fichier, fiche de 16, story de 19, vecteurs de 08, la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : tests, `docs/team/reviews/US-xxx/qa-<date>.md`.
- **Format de rapport** (≤ 1 page) : gabarits du handoff §4.4 ; un rapport de revue suit `docs/team/reviews/TEMPLATE.md` et se termine par `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: qa` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
