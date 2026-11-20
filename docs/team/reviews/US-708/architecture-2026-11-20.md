# Revue architecture — US-708 « Versements aux hôtes par le PSP depuis la jambe HOST » (PR n° 273, revue delta de fusion) — 2026-11-20

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : e9ef2267..60dcf162

Revue delta de fusion du rapport précédent [`architecture-2026-11-19b.md`](./architecture-2026-11-19b.md) (APPROUVÉ à e9ef2267). Depuis : ff52af10 (merge de origin/main avec #271 US-308, migration 0164, conflits résolus) puis 60dcf162 (schema.md recopié de la CI). Pour chaque fichier partagé touché (modules.md, schema.md, packages/db/README.md, authorization-matrix.json, personal-data-inventory.json, security-definer-allowlist.json, avl-schema.test.ts, COMME_TURO.md), `git diff 84d35703 60dcf162` (apport de la PR sur le main actuel) a été comparé à `git diff bf989b30 e9ef2267` (apport revu) : lignes ajoutées et retirées identiques, aucune entrée de main supprimée ni modifiée. `git diff e9ef2267 60dcf162` sur la migration 0165, apps/api/src/modules/pyo et pay : vide. schema.md : compteurs 166 migrations, 147 tables, 829 politiques, 345 fonctions SECURITY DEFINER, objets payout_* conformes à la migration, identique à la sortie CI. CI du run 44671190131 entièrement verte.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                      |
| --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **Résolution du merge sans perte ni affaiblissement.** modules.md et schema.md : ligne PYO de modules.md (dépendances IAM, PAY, BUS) et le tableau des migrations (0165 ajoutée après 0164) identiques au rapport revu ; aucune ligne de main retirée hors celle que la story réécrit (PYO). |

Verdict : APPROUVÉ
