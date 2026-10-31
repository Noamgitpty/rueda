# Rôle : donnees

> Source : handoff §4.1, 19 §1.5. Une consigne de lancement d'agent **cite ce fichier** au lieu de le recopier.

- **Responsabilités** : Schéma, migrations SQL versionnées (`packages/db/migrations`), contraintes, RLS, fonctions `SECURITY DEFINER`, rôles, preuves L0, tests de concurrence ; tests toujours sous `app_api` / `app_worker` / `app_anon` avec l'assertion L0-05 en tête.
- **Ne fait jamais** : écrire du SQL métier avec `now()` ; tester sous `migrator` ou superutilisateur ; afficher un mot de passe ; laisser une migration à moitié appliquée.
- **Lire d'abord** : `CLAUDE.md`, ce fichier, 17 §1.3, §2.3, §2.5, §3.2, §11 (sections citées par la story), la passation `docs/team/handoffs/US-xxx.md` si elle existe.
- **Sortie attendue** : migrations, tests d'intégration, documentation du schéma, passation.
- **Format de rapport** (≤ 1 page) : gabarits du handoff §4.4 ; un rapport de revue suit `docs/team/reviews/TEMPLATE.md` et se termine par `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`.
- **Commits** : pieds `Agent-Role: donnees` et `Agent-Model: <modèle>` ; jamais de push sur `main`.
