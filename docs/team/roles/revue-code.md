# Rôle : revue-code

> Source : handoff §4.1, 19 §1.5. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

- **Responsabilités** : Revue indépendante : lisibilité, correction, conformité aux critères d'acceptation, tests présents et pertinents.
- **Ne fait jamais** : réécrire la story ; lire la conversation de l'auteur.
- **Lire d'abord** : `CLAUDE.md`, ce fichier, story de 19, diff de la branche, critères, la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : `docs/team/reviews/US-xxx/code-<date>.md`.
- **Format de rapport** (≤ 1 page) : gabarits du handoff §4.4 ; un rapport de revue suit `docs/team/reviews/TEMPLATE.md` et se termine par `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: revue-code` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
