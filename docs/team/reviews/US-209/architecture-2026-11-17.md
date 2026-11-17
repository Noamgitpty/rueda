# Revue architecture — US-209 « écrans voyageur (209c) » (PR n° 197) — 2026-11-17

Relecteur : revue-architecture / claude-sonnet-5-5 (famille A, modèle autre que l'auteur claude-opus-5-5)
Entrées : 085de1c3..93783107

Contexte : relus ADR-144, la migration 0120 contre 0108 et 0119, le découpage API / base / web, `docs/architecture/schema.md`, les README, GO_LIVE GL-17 et le handoff. Aucun PostgreSQL lancé ; CI verte à 93783107 (non rejouée).

| #   | Gravité | Constat                                                                                                                                                                                                                                                                                                                                 |
| --- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | INFO    | Expand / contract respecté : fonction ajoutée, `booking_checkout_summary` inchangée (changer son type de retour exigerait un `DROP`, contraction). Retour arrière documenté. Les deux fonctions sont lues dans une instruction : pas de demi-état entre elles ; coût d'une résolution de session en double, négligeable.                |
| 2   | INFO    | Le contrat `reviewState` est additif dans l'OpenAPI (requis dans la réponse) et refermé côté consommateur (état inconnu refusé) : un déploiement de l'API avant la base, ou du web avant l'API, échoue fermé (503 ou erreur), jamais en laissant payer.                                                                                 |
| 3   | INFO    | Modules : le web ne lit que l'API ; l'API reste dans `avl` ; aucune importation interne ; la dérivation de l'état vit dans la base (source unique, 17 §2.5) et non dans le web. Interrupteurs de pays seulement lus, aucun écrit.                                                                                                       |
| 4   | INFO    | Numérotation (0120, ADR-144, v64) conforme à la consigne ; renumérotation à la fusion si US-211 passe avant, annoncée (handoff, ADR). `numbering.test.ts` exige la contiguïté : l'orchestrateur doit rejouer la CI après renumérotation.                                                                                                |
| 5   | MINEUR  | Aucune notification du voyageur (aucun consommateur de `booking.hold.review_decided`, charge utile sans identifiant du voyageur). Honnêtement tracée (ADR-144 point 7, GL-17), mais c'est la condition réelle de l'ouverture d'un pays : la story NTF doit être planifiée avant que `foreign_license_review_enabled` ne passe à `true`. |
| 6   | MINEUR  | La relecture toutes les 30 s est un choix local (pas de canal poussé) : acceptable pour la bêta, à reconsidérer avec la story NTF ; l'ADR ne chiffre pas la charge induite.                                                                                                                                                             |

Verdict : APPROUVÉ
