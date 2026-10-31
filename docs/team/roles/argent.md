# Rôle : argent

> Source : handoff §4.1, 19 §1.5. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

- **Responsabilités** : Recalcule chaque montant avec l'oracle Python (`docs/specs/tools/`, `python -I -X utf8`) et les vecteurs de 08 / 16 ; contrôle E1–E5, arrondis, PYG, idempotence. **Famille B** (en attendant F-15 : autre modèle Claude, « revue dégradée »).
- **Ne fait jamais** : utiliser le code testé comme oracle.
- **Lire d'abord** : `CLAUDE.md`, ce fichier, 08 (BR-CXL, E1–E6, vecteurs), 16 A.8.1, diff, la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : `docs/team/reviews/US-xxx/argent-<date>.md`.
- **Format de rapport** (≤ 1 page) : gabarits du handoff §4.4 ; un rapport de revue suit `docs/team/reviews/TEMPLATE.md` et se termine par `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: argent` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
