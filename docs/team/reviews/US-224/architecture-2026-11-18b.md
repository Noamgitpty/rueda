# Revue architecture — US-224 « remboursements multi-moyens, TJ16 (224f) » (PR n° 239) — 2026-11-18

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : b9dec048df4f061fb0bdb6244dcb9c62eb8adbea..4b43a2c0397b1938c7233a19c4232933cdcc0c57

Contexte : lu ADR-166 (PROPOSÉ ; complète ADR-145 / 147 / 148 / 150 / 154), 0141, `schema.md`, README db / STL / PAY, GL-43, passation 224f, 17 v6 (§3.2.7, §4.3, §0.1). `origin/main` (b9dec048) est ancêtre de la tête. Non exécuté : test `schema-doc` (CI verte).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                             |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | Numérotation 0141 contiguë avec main (0140) ; fichier, en-tête, README db, ADR et passation alignés ; expand / contract respecté (une fonction et un droit de colonne ajoutés, trois corps remplacés à signature et droits identiques, retour arrière décrit). `schema.md` recopié du job base de données (142 migrations, 285 `SECURITY DEFINER`). |
| 2   | INFO    | Frontières de modules respectées : STL n'importe que `@rueda/money` et l'index public de PAY (`awaitChoice` via `PgRefundOrders`) ; fonction pure dans `@rueda/money` sans constante de pays ; aucune modification de `docs/specs/`, `.github/` ni `scripts/`.                                                                                      |
| 3   | MINEUR  | `CATALOG_VERSION` passe de 78 à 81 avec 79 et 80 « réservées » à US-225 et US-227 : trou tant que ces PR ne sont pas fusionnées, conflit probable sur la même ligne ; GL-41 et GL-42 de même absents (réservés). Sans effet fonctionnel.                                                                                                            |
| 4   | INFO    | Suites bien tracées (choix du rail sur S10 et virement OQ-BR-12, TJ16d après `funds_holding_enabled`, `payment_cmd_record_operation` acceptant un encaissement crédit, OQ-BR-44, E5, change) dans ADR-166, GL-43 et la passation ; `COMME_TURO.md` : une entrée PROPOSÉ ; aucune décision du fondateur prise à sa place.                            |
| 5   | MINEUR  | Inversion de verrous `markAlerted` puis `awaitChoice` (revue sécurité n° 4) : contredit l'ordre trip → instance posé par 224c / 224e et affirmé dans le commentaire de 0141:367.                                                                                                                                                                    |

Verdict : APPROUVÉ
