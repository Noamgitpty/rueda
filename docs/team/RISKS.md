# RISKS — registre des risques

> Tenu par l'orchestrateur (+ red team, pré-mortems). Amorcé le 2026-10-31 à partir de `docs/specs/18_MVP_AND_ROADMAP.md` §7 (risques du plan, préfixe `P`) et de `docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md` §8.2 (risques techniques, préfixe `R` repris tel quel), complétés par le pré-mortem du lot 0 (`L0-`). Les parades détaillées sont dans les sources ; ici on suit l'état.

| ID | Risque | Probabilité | Impact | Parade | Propriétaire | Statut | Source |
|---|---|---|---|---|---|---|---|
| L0-PM-01 | Une preuve L0-01..L0-09 échoue : conception 17 §2.3 / §2.5 non tenable sous les rôles de production | moyenne | élevé | preuves en tout premier (US-005 → US-006 → US-007) ; échec ⇒ révision de 17 §2.3 / §2.5 et ré-estimation avant le lot 2 | orchestrateur + agent données | OUVERT | pré-mortem L0 ; 18 §7 |
| L0-PM-02 | Famille B (autre fournisseur) indisponible : erreurs corrélées entre auteur et relecteur | élevée (actuel) | élevé | revue dégradée sur un autre modèle Claude (TECH-007), rejouée en famille B avant la production ; F-15 au 1er point hebdomadaire | orchestrateur / fondateur (F-15) | OUVERT | pré-mortem L0 |
| L0-PM-03 | Docker absent du poste : divergence entre le banc local (PG natif) et la CI (Testcontainers) | élevée (actuel) | moyen | P-07 (TECH-002, ADR-043) : même version majeure 16, base jetable par série de tests ; **la CI fait foi** ; harnais unique paramétré par URL | agent données | OUVERT | pré-mortem L0 ; handoff §5 |
| L0-PM-04 | Limite d'usage atteinte en pleine story | élevée | moyen | protocole de reprise (OPERATING_RULES §3) ; commits poussés à chaque étape ; RESUME_HERE à jour ; exercice US-050 | orchestrateur | OUVERT | pré-mortem L0 |
| L0-PM-05 | Fondateur indisponible pour DEC-MARQUE (ou pour approuver la 1re fusion) | moyenne | moyen | défaut `{brand_name}` et thème neutre (le build continue) ; propositions US-028 prêtes tôt ; décisions groupées au point hebdomadaire | orchestrateur | OUVERT | pré-mortem L0 |
| L0-PM-06 | Deux Node.js dans le PATH (Node 22 d'une autre application) : outils exécutés avec la mauvaise version | moyenne | faible | `.nvmrc` + `engines` (ADR-041) ; scripts qui préfixent `C:\Program Files\nodejs` ; contrôle `node -v` en tête de passation | orchestrateur | OUVERT | constat poste 2026-10-31 |
| L0-PM-07 | Identité option A : l'auteur des commits = l'approbateur humain (revue ≠ auteur non démontrable par GitHub) | certaine (actuel) | moyen | pieds `Agent-Role` / `Agent-Model`, rapports de revue versionnés, aucune fusion sans accord explicite du fondateur ; F-01 option B | orchestrateur / fondateur (F-01) | OUVERT | handoff §4.10 |
| L0-PM-08 | Fuite du mot de passe superutilisateur local (affiché dans une sortie, commité) | faible | moyen | fichier hors dépôt, lu par chemin seulement, jamais affiché ; `.gitignore` des `*.secret` ; analyse de secrets en CI (US-002) | agent données | OUVERT | P-07 |
| L0-PM-09 | G0 négatif après le lot 0 (commission refusée) : ≈ 222 points perdus | moyenne | élevé | entretiens F-16 dès le lot 0 ; critère d'arrêt écrit avant les entretiens | fondateur | OUVERT | 18 §7 (constat 24-01) |
| P-01 | Avis art. 288 / OQ-MK-02 négatif sans montage : Panama sorti | moyenne | élevé | deux pays construits (DEC-FONDATEUR-04) ; Paraguay pays de lancement | fondateur | OUVERT | 18 §7 |
| P-02 | `FAKE` actif en production | faible | élevé | contrainte, image sans `FAKE`, refus de démarrage, test C19 | agent intégrations | OUVERT | 18 §7 ; R20 |
| P-03 | PSP du pays de lancement refuse ou tarde | moyenne | élevé | porte PAY-041, mode (b), second PSP | fondateur | OUVERT | 18 §7 |
| P-04 | PWA iOS inadaptée à la preuve photo | moyenne | moyen | US-026 au lot 0 ; repli décidé fin du lot 0 (ADR-005) | agent front-end | OUVERT | 18 §7 ; R8 |
| P-05 | Fondateur goulot (seul humain) | élevée | moyen | point hebdomadaire unique, ≤ 5 décisions, défauts appliqués | orchestrateur | OUVERT | 18 §7 |
| P-06 | Erreur d'agent présentée avec assurance | élevée | élevé | vérificateurs indépendants, double revue argent / sécurité / réservation, oracles Python | orchestrateur | OUVERT | 18 §7 |
| P-07 | Mise en place externe tardive (comptes, domaine, marque) | moyenne | moyen | registre des comptes (US-037), build contre `FAKE` | fondateur | OUVERT | 18 §7 |
| P-08 | Contournement de la commission | moyenne | élevé | FIN-019, ADM-005, clause LEG-025 | orchestrateur | OUVERT | 18 §7 |
| P-09 | Agence défaillante après encaissement | faible | élevé | KYB, plafond de prépaiement, garantie (OQ-MK-11) | fondateur | OUVERT | 18 §7 |
| R1 | Double remboursement ou remboursement non encaissé | moyenne | élevé | E1 + E4, supersession, T49–T68 | agent back-end + vérif. argent | OUVERT | 17 §8.2 |
| R2 | Double réservation (dont expiration pendant la conversion) | moyenne | élevé | ADR-002, conversion gardée, I-OCC, C1–C20 | agent données | OUVERT | 17 §8.2 |
| R3 | Capacité PSP supposée mais absente | élevée | élevé | `psp_capability` fail-closed | agent intégrations | OUVERT | 17 §8.2 |
| R4 | Erreur d'arrondi ou de devise (PYG) | moyenne | moyen | `bigint`, T27, T40, T41, T48, T55 | agent back-end + vérif. argent | OUVERT | 17 §8.2 |
| R5 | Erreur de fuseau (Asunción) | faible | moyen | ADR-019, EC-33 | agent back-end | OUVERT | 17 §8.2 |
| R6 | Fuite de données sensibles | moyenne | élevé | classes C3/C4, chiffrement, ADM-033 | vérif. sécurité | OUVERT | 17 §8.2 |
| R11 | Complexité du moteur de règlement | moyenne | élevé | moteur pur, oracles portés en tests dorés | orchestrateur | OUVERT | 17 §8.2 |
| R12 | Webhook falsifié | moyenne | élevé | signature ou rappel ; captures refusées | agent intégrations | OUVERT | 17 §8.2 |
| R15 | Dérive entre 08 et le code | moyenne | élevé | tests dorés et transitions générées depuis 08 | orchestrateur | OUVERT | 17 §8.2 |
| R16 | Paiement encaissé sans créneau | moyenne | moyen | `payment_in_flight_until`, libération différée | agent données | OUVERT | 17 §8.2 |
| R18 | Fuite inter-agences (IDOR) | moyenne | élevé | RLS par acteur, RLS-1 à RLS-20 | vérif. sécurité | OUVERT | 17 §8.2 |
| R19 | Coupe Bêta sous-estimée | élevée | moyen | mesure US-027 et recalage | orchestrateur | OUVERT | 17 §8.2 |
| R21 | Tests exécutés sous un rôle propriétaire | moyenne | élevé | ADR-035, L0-05 en tête de chaque test | agent données | OUVERT | 17 §8.2 |

Les autres risques de 17 §8.2 (R7, R9, R10, R13, R14, R17, R20) et de 18 §7 sont suivis dans leurs sources jusqu'à leur lot ; ils seront ajoutés ici au pré-mortem du lot concerné.
