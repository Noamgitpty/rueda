# Revue architecture — US-221 partie 221b « report de la capture convertie sur les soldes par jambe » (PR n° 246) — 2026-11-18 (s, delta)

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 278850cd..2151c3f7 (SHA revu : 2151c3f7)

Contexte : delta `git diff 328dc8d7 2151c3f7` sur les fichiers de la PR (fusion de main avec #244 et #247, migration renumérotée 0147 → 0149) ; revues précédentes APPROUVÉ au SHA c4bb41e6 (`architecture-2026-11-18r.md`) reprises pour le reste ; aucune base ni Docker démarrés ici.

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                              |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | **Delta** : Renumérotation 0147 → 0149 après #244 (0147) et #247 (0148) ; ni 0147 ni 0148 ne redéfinissent `booking_convert_payment`, `finance_trip_leg_facts` ni `settlement_cmd_apply_leg_movement` (recherche par nom : aucune occurrence), donc aucune des deux recopies de corps n’est périmée. |
| 2   | INFO    | **Fusion de main** : le fichier de migration est un renommage à deux lignes modifiées (numéro dans l'en-tête et le retour arrière) ; la fixture, le test L0, les tests et la documentation de la PR ne changent que par le numéro ; `schema.md` ne gagne que les lignes de 0149.                     |

Verdict : APPROUVÉ
