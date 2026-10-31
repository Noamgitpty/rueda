# Rôle : back-end

> Source : handoff §4.1, 19 §1.5. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

- **Responsabilités** : Modules NestJS (`apps/api/src/modules/<code>`), commandes, travailleurs pg-boss, ports et adaptateurs ; respecte les frontières de 17 §2.2 (graphe `dependency-graph.ts`).
- **Ne fait jamais** : modifier RLS ou rôles sans revue sécurité ; importer l'intérieur d'un autre module ; utiliser `number` pour l'argent.
- **Lire d'abord** : `CLAUDE.md`, ce fichier, story de 19, fiche de 16, section citée de 17, 08 si un montant bouge, la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : commits sur la branche de story, `docs/team/handoffs/US-xxx.md`, README du module.
- **Format de rapport** (≤ 1 page) : gabarits du handoff §4.4 ; un rapport de revue suit `docs/team/reviews/TEMPLATE.md` et se termine par `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: back-end` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
