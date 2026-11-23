# ADR-203 — Refacturation des amendes, péages et fourrières : clé canonique du PV, unicité par compte d'hôte du pays, seuil cumulé du trip revu par l'ops

- **Statut** : PROPOSÉ (US-318 suite 2, agent de story, rôle back-end, claude-opus-5-5, 2026-11-23). Revues exigées : code, architecture, sécurité, argent, ux, qa (`docs/team/review-requirements.json`) ; argent, RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-198 (refacturation, 0178), ADR-201 (référence unique par trip, délai du voyageur, décision de l'ops, plafond du pays, 0181), ADR-195 (décisions motivées), ADR-199 (aucune politique nouvelle de `cmd_hold_owner` sur `config_param_value`).
- **Sources** : passe de porte de la red team du lot 3, `docs/team/redteam/L3-porte.md` (RT-L3-S04, `rt-l3-11-variantes`) : **F-L3-SIN-03** et **F-L3-SIN-05** (critiques), **F-L3-SIN-04** (relevé critique, ramené à élevé par la revue argent de la red team : 08 ne fixe aucun plafond par trip, plusieurs amendes réelles sur un même trajet sont légitimes) ; 08 BR-TT-02 à 04, BR-REIMB-03, BR-REIMB-05 (« doublons », « montant non justifié » interdits) ; DEC-FONDATEUR-22 (« jamais plus lourd que Turo »).

## Contexte

0181 rend une référence de PV unique **par trip** par une clé `reference_key` = majuscules, lettres et chiffres. La red team montre trois contournements : la même référence écrite autrement (« PV 000123 » / « PV 123 », « PV 100200 » / « PV 1OO2OO ») a une autre clé (SIN-03) ; le même PV déclaré sur deux trips du même hôte est refacturé à deux voyageurs, alors qu'une amende n'a qu'un conducteur (SIN-05) ; trois refacturations à 60 % du plafond d'une refacturation passent, 180 % sur un trip (SIN-04).

## Décision

1. **Clé canonique** (SIN-03) : `core.claim_traffic_reference_key(text)`, fonction SQL immuable, seule définition (colonne générée `reference_canonical_key`, déclaration). Étapes : majuscules ; séparateurs retirés (comme 0181) ; dans chaque suite **maximale** de chiffres et de lettres O, I, L qui contient au moins un chiffre (quel que soit son premier caractère), O vaut 0 et I ou L valent 1, puis ses zéros de tête sont retirés (un zéro seul reste). Exemples (oracles des tests) : « PV 000123 », « PV 123 », « pv-0123 », « PV O123 » → `PV123` ; « PV 100200 », « PV 1OO2OO », « PV-100-200 », « PV I00200 », « PV L00200 » → `PV100200` ; « PV O00200 » → `PV200` ; « BOL 2024 » → `B12024` (une lettre O, I ou L collée à un numéro est lue comme un chiffre) ; « PV 2066-0042 » = « PV20660042 » (équivalence de 0181 gardée). Les homoglyphes non ASCII restent refusés par le format fermé de 0181. `reference_key` (0181) et son index par trip sont gardés : la version N les lit, et le nouvel index les implique.
2. **Unicité par compte d'hôte du pays** (SIN-05) : index unique partiel `claim_traffic_charge_reference_host_unique` (pays, `org_id`, clé canonique), version 2. Une référence d'avis désigne une infraction d'**un** véhicule ; un véhicule appartient à un seul compte d'hôte, donc (pays, hôte) couvre (pays, véhicule). C'est plus sûr : le même véhicule réinscrit sous une autre fiche, ou un PV attribué à la mauvaise voiture du même hôte, ne passe pas non plus. Une portée globale (pays seul) refuserait deux hôtes dont les reçus de péage portent par hasard le même numéro : écartée. Doublon ⇒ `TRAFFIC_DUPLICATE` (identifiant de la refacturation existante), même sur un autre trip ; une refacturation rejetée garde sa référence (jamais redemandée). Course : verrou consultatif de l'hôte (`claim.traffic.host:<pays>:<org>`), pris avant celui du trip (ordre fixe ; aucune autre commande ne prend le verrou de l'hôte) ; l'index est la garde de dernier recours.
3. **Seuil cumulé du trip, revue de l'ops** (SIN-04) : paramètre `traffic_trip_charge_max_minor[pays]` (MONEY, PROPOSÉ : 1 000,00 USD au PA, 7 500 000 PYG au PY, égal au plafond d'une refacturation). La somme des montants déclarés (frais de gestion non compris) des refacturations du trip, **sauf celles rejetées par l'ops**, est lue sous le verrou du trip. Si la nouvelle déclaration la porte au-delà du seuil (strictement), la refacturation est **enregistrée** avec `ops_review_required = true` (figé par la garde, annoncé au récapitulatif et à la réponse : `opsReviewRequired`) et n'est **jamais débitée sans décision de l'ops** : contestée par le voyageur, elle suit la décision d'ADR-201 (débit réservé à ADMIN) ; payée ou restée sans réponse à l'échéance, le travailleur la passe en BLOCKED `TRAFFIC_OPS_REVIEW_REQUIRED` (alerte P1 `CLAIM_TRAFFIC_BLOCKED`, reprise par l'ops). La contrainte `claim_traffic_charge_review_before_charge` prouve en base qu'une telle refacturation n'a jamais d'autre base de débit que `OPS_DECISION`. Paramètre absent ou mal formé ⇒ `TRAFFIC_CAP_UNKNOWN` (rien d'écrit, fail-closed). Le plafond d'**une** refacturation (ADR-201) reste un refus.
4. **Données existantes** : la colonne générée calcule la clé canonique de chaque refacturation déjà écrite ; si deux refacturations de version 2 d'un même compte d'hôte du pays ont la même clé, 0183 échoue **en bloc** (`unique_violation`, rien d'appliqué), reprise par l'ops : jamais un choix silencieux entre deux lignes.
5. **Droits** : seuil lu par `core.claim_traffic_trip_cap` (`cmd_money_owner`, `SECURITY DEFINER`, EXECUTE `cmd_hold_owner`) ; politique `cmd_money_traffic_guest_param_read` recréée sous son nom (+ une clé) ; aucune politique nouvelle de `cmd_hold_owner` ; la fonction de la clé (non `SECURITY DEFINER`) est exécutable par `cmd_hold_owner` et `cmd_money_owner` (évaluation de la colonne générée), jamais par PUBLIC. RLS ENABLE + FORCE inchangée.

## Conséquences

- Le même PV n'est refacturé qu'à un voyageur d'un hôte, quelle que soit son écriture courante.
- Au-delà du seuil cumulé, l'hôte déclare normalement ; le voyageur est avisé et peut contester ; Kmino ne débite qu'après la décision de l'ops. L'hôte d'un trajet à plusieurs amendes réelles n'est jamais refusé (jamais plus lourd que Turo, dont le support revoit les cas hors norme).
- Une refacturation payée ou silencieuse au-delà du seuil reste BLOCKED jusqu'à l'outil de reprise de l'ops (suite déjà inscrite par ADR-201) : aucun débit, jamais un débit de trop.

## Limites assumées (clé canonique)

- Un préfixe ajouté ou retiré (« A-77-4410 » / « 77-4410 »), des zéros après un séparateur au milieu d'un numéro (« 12-0034 » / « 12-34 ») restent des références distinctes : aucune équivalence de texte libre n'est prétendue. Correctif de la revue sécurité et argent (cde5b982) : une lettre O, I ou L en tête d'un numéro (« PV I00200 », « PV O123 ») n'est plus un contournement. Le seuil cumulé du trip (revue de l'ops) et la contestation du voyageur bornent ces cas.
- Rares faux doublons possibles chez un même hôte (« PV 123L » et « PV 1231 », « BOL 2024 » et « B12024 ») : l'hôte passe par le support.

## Options écartées

- Refus au-delà du cumul (`TRAFFIC_TRIP_CAP_EXCEEDED`) : plus lourd que Turo, 08 ne fixe aucun plafond par trip (revue argent de la red team).
- Unicité par (pays, véhicule) seule : ne couvre pas le véhicule réinscrit ni l'erreur de véhicule ; unicité par pays seul : faux doublons entre hôtes.
- Réécrire `reference_key` (supprimer puis recréer la colonne) : contraction lue par la version N ; une colonne nouvelle suffit.
- Escalade dès qu'un numéro « proche » arrive : critère flou ; la clé canonique et le seuil cumulé sont vérifiables.

## Suites

- Liste « à revoir » de la console étendue aux refacturations `ops_review_required` non contestées, décision de l'ops sur elles et reprise des BLOCKED (avant l'ouverture de la bêta).
- Avis à l'hôte et au voyageur qu'une refacturation est en revue ; vue de l'hôte (`claim_host_trip_claims`) avec `opsReviewRequired`.
- PR de spécifications : paramètre `traffic_trip_charge_max_minor` dans 17 §7.2 ; code de blocage `TRAFFIC_OPS_REVIEW_REQUIRED`.
