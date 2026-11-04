# ADR-076 — Propriétés monétaires comparées aux oracles et tests de mutation de `@rueda/money`

- **Statut** : PROPOSÉ (US-042, agent back-end, claude-opus-5-5, 2026-11-03). Revues exigées : code, **argent** et qa (story ; `packages/money/`), **sécurité** (`.github/`), sur un autre modèle que l'auteur. À reporter dans 17 §8.1 (liste des ADR) et §9 (stratégie de test : propriétés et mutation).
- **Sources** : 19 US-042 (critères : 10 000 cas comparés à l'oracle, 0 écart ; score de mutation ≥ 80 %, PROPOSÉ, sinon fusion refusée ; exécutions nocturnes) ; 08 BR-PRICE-14, BR-CXL (table de décision, pseudo-code), E4, E7 ; `docs/specs/tools/independent_settlement_check.py` (fuzz de 20 000 cas), `check_legs.py` ; ADR-054 (moteur bêta), ADR-057 (règlements persistés), ADR-068 (fuzz C11 : mode court sur PR, mode long la nuit).

## Contexte

Les vecteurs dorés (US-016) fixent des points ; les propriétés d'US-015 et d'US-017 vérifient des invariants, mais aucune ne compare le moteur à l'oracle **hors des vecteurs**, et rien ne mesure la capacité des tests à détecter une erreur. Contraintes : l'attendu vient de 08 et des oracles Python, jamais du code testé ; aucune modification de `docs/specs/` ; USD et PYG ; aucune constante pays ; CI de durée raisonnable ; fraîcheur des dépendances ≥ 14 jours (US-001).

## Décision

1. **Comparaison différentielle aux oracles** (`test/oracle/`, commande `test:oracle`, hors `test:unit` car elle exige Python) : fast-check **génère les entrées** (`fc.sample`, graine fixe `20261103` ou `RUEDA_MONEY_ORACLE_SEED`) ; `oracle_driver.py` les évalue en **composant les fonctions des oracles** (`mk_trip`, `compute`, `settle` d'`independent_settlement_check.py` ; `legs`, `diff` de `check_legs.py`, chargé seulement s'il rend « RÉSULTAT : OK ») ; le moteur est comparé champ par champ. Le pilote ne tire rien au hasard et ne calcule aucun montant : la taxe payée et le total payé du trip viennent eux aussi de l'oracle. Lancement par `python -I -X utf8`, fichiers d'échange temporaires.
2. **Ce qui est comparé** : primitives (`roundHalfUp`, `allocHost`) ; règlement (motif qualifié, en-tête, remboursement par ligne, taxe par groupe, jambes de capture, retenues, variation, `negativeLeg`) en option A (compensation, comme l'oracle) et en option B (défaut fail-closed : attendu = oracle sans compensation, net plateforme + compensation) ; version 1 persistée (`kept` = max(0, jambe), `advance` = manque, `basis` = capture ; capture à jambe négative ⇒ `LEG_AMOUNT_NEGATIVE`, 08 E7 règle 5), version n+1 d'un second événement et `settlementDelta` (08 E4). Invariants contrôlés à chaque cas. Le générateur vérifie lui-même qu'il exerce les deux devises, chaque motif bêta, une compensation et une jambe négative.
3. **Volume** : 10 000 règlements et 2 × 5 000 primitives sur chaque PR (moins de 30 s) ; la nuit, 100 000 règlements et 2 × 50 000 primitives avec la graine du jour (job `argent-oracles-long`, même principe que le fuzz C11 d'ADR-068).
4. **Domaine** : celui où l'oracle VERIF_09 et le moteur bêta décrivent la même règle de 08 (limites ci-dessous). Une promo est taxée avec P (BR-PRICE-16), jamais seule.
5. **Propriétés complémentaires** dans `test:unit` (`test/monotonicity.properties.test.ts`) : monotonie et bornes des primitives, conservation des jambes et du règlement, en PA et PY. Elles complètent celles d'US-015 et d'US-017 sans les dupliquer.
6. **Mutation : Stryker 10.0.0** et `@stryker-mutator/vitest-runner` 10.0.0, dépendances de test de `@rueda/money`. 10.1.1 a moins de 14 jours (`minimumReleaseAge`). Le lanceur 10.0.0 date d'avant Vitest 5, qui filtre `testNamePattern` sur `fullTestName` (« suite > test ») : sans correctif, aucun test ne tourne pour un mutant et **tous survivent** (score mesuré : 0 % sur `legs.ts`). Le correctif `patches/@stryker-mutator__vitest-runner@10.0.0.patch` (`pnpm.patchedDependencies`, 2 fonctions, 8 lignes) fait utiliser `fullTestName` au lanceur ; il se retire en montant de version, dès qu'une version de plus de 14 jours le fait.
7. **Périmètre muté** : `src/*.ts` et `src/settlement/*.ts` (primitives, moteur de règlement, jambes, règlements persistés), hors `index.ts`. Hors périmètre : le **harnais des vecteurs dorés** (`src/golden-vectors/`, réservé aux tests, non exporté par `@rueda/money`) : un mutant y rend un test plus faible, pas un montant faux, et il est contrôlé par `test/golden-vectors/`.
8. **Suite rejouée par mutant** (`vitest.mutation.config.ts`) : tests unitaires et comparaison aux oracles réduite à 2 000 cas. Les attendus de l'oracle ne dépendent que des cas et des oracles, jamais du code muté : ils sont calculés une fois puis lus dans un cache (`RUEDA_MONEY_ORACLE_CACHE`, clé SHA-256 des cas, du pilote, des deux oracles et de 08 ; écriture atomique).
9. **Seuils** : `break` = **80 %** (19, PROPOSÉ) ; `low` = 90, `high` = 95 (affichage). Score obtenu : voir « Mesures ». Le seuil reste à 80 % et non au score obtenu : un mutant équivalent ajouté par une évolution légitime ne doit pas bloquer une fusion, et la liste des survivants est revue à chaque story qui touche le paquet.
10. **CI** : `argent-oracles` sur chaque PR et `main` ; `argent-mutation` sur `main`, à la demande, la nuit (via `suite-complete`) et sur les seules PR qui touchent `packages/money/` ou `patches/` (« mode rapide » : le job reste vert avec une notice sinon) — c'est le cas exigé par 19 (« la fusion qui les modifie est refusée »). Permissions `contents: read`, actions épinglées par SHA, aucun secret, aucun `continue-on-error`, job `revues` inchangé.

## Mesures (2026-11-03, poste local, 4 processus)

À compléter par la passation (score global, par fichier, durée).

## Limites et conséquences

- **Fins anticipées et encaissements partiels** (critère 1 de 19) : aucun moteur TypeScript ne les implémente encore (moteur complet US-518 ; encaissement, ordres et avances US-223 / US-224). Le pilote les comparera sur le même principe (`compute_termination` et `cash` d'`independent_settlement_check.py`, `partial` de `check_legs.py`) quand ces stories livreront le code. Report noté dans la passation.
- **Moteur de devis** (critère 2 de 19) : il n'existe pas encore ; il entrera dans le périmètre muté (et la comparaison aux oracles) avec sa story.
- No-show du voyageur limité à la fenêtre `[noShowAt ; T + 72 h]` : l'oracle ne modélise pas `REJECTED_TOO_EARLY` ni la fin de fenêtre (T06, T39 et les propriétés d'US-017 les couvrent). Promos dans le domaine du fuzz de l'oracle (PP ≥ −P/5, PH ≥ −P/10) et part hôte ≥ ½ : le plancher T63 reste couvert par son vecteur doré.
- Option B dérivée de l'oracle (option A) par une identité de 08 E7, pas calculée par un oracle B : une révision de l'oracle devra l'ajouter (report dans `docs/specs/tools/` par une PR revue argent).
- La mutation complète dure environ 10 min sur 4 processus ; sur une PR qui ne touche pas l'argent, elle ne coûte rien.
- Le correctif du lanceur est une dépendance de test patchée : un relecteur sécurité doit l'avoir lu (8 lignes, aucun accès réseau ni fichier).

## Alternatives écartées

- **Attendus pré-calculés commités** (10 000 cas) : plusieurs mégaoctets à régénérer à chaque évolution du générateur, et le domaine ne varie plus la nuit.
- **Générer les cas en Python** : le générateur vit avec les types du moteur et fast-check fournit la graine et la reproductibilité ; Python reste un pur évaluateur.
- **Lanceur « commande » de Stryker** (toute la suite par mutant) : sans correctif, mais 3 à 4 fois plus long.
- **Stryker 10.1.1** : interdit par la politique de fraîcheur jusqu'au 2026-11-06.
- **Seuil au score obtenu** : bloquerait une évolution légitime pour un mutant équivalent ; 80 % est la valeur de 19.
