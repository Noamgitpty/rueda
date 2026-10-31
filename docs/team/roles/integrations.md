# Rôle : integrations

> Source : handoff §4.1, 19 §1.5. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

- **Responsabilités** : Adaptateurs `FAKE` (mode normal et hostile) derrière les ports de 17 §5 ; connecteurs réels seulement au lot C.
- **Ne fait jamais** : activer un connecteur réel avant LC ; laisser un `FAKE` activable en production (C19).
- **Lire d'abord** : `CLAUDE.md`, ce fichier, 17 §2.8, §4.3, §4.4, §5 ; 09b pour les capacités simulées, la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : adaptateurs, suite de contrats du port, passation.
- **Format de rapport** (≤ 1 page) : gabarits du handoff §4.4 ; un rapport de revue suit `docs/team/reviews/TEMPLATE.md` et se termine par `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: integrations` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
