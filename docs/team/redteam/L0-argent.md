# Red team L0 — axe « argent » (US-049, critère 2)

- Auteur : agent red team, `claude-sonnet-5-5`. **Revue dégradée TECH-007** : le code attaqué est de la famille A (Opus), la famille B n'est pas disponible. Un second passage famille B reste souhaitable avant la fusion de la porte.
- Branche `story/US-049-redteam-argent`, PR en brouillon. Aucun code de production modifié ; les gravités ci-dessous sont **PROPOSÉES**.
- Périmètre : moteur `@rueda/money` (module settlement / FIN), commandes `core.settlement_cmd_record` et `core.settlement_cmd_apply_leg_movement`, commandes de paiement `core.payment_cmd_record_operation` et `core.payment_cmd_apply_operation_status`, garde FAKE et garde de détention de fonds. Sections lues : 08 E1, E4, E7 ; 17 §2.9, §3.2.8, §4.3 ; migrations 0027, 0028, 0036, 0039, 0040 ; ADR-057, ADR-059, ADR-066.

## Comment rejouer

Les tests sont `packages/db/test/l0/redteam-argent-engine.test.ts`, `redteam-argent-settlement.test.ts` et `redteam-argent-psp-legs.test.ts`. Ils sont attrapés par le motif `test/l0/**` de `vitest.l0.config.ts`, donc par `pnpm test:l0` (job « base de données » de la CI), sous les rôles de production (assertion L0-05 en tête de chaque test), en USD (PA) et en PYG (PY). Les montants attendus viennent de l'export des oracles Python (`@rueda/money/golden-vectors` : T03, T05, T08, T27, T36, T41, TJ01, TJ02b, TJ08a/b, TJ10a/b/c) et de la formule de 08 (références `bigint` réécrites dans le test, pas le code testé).

```bash
pnpm --filter @rueda/db test:l0 -- redteam-argent        # CI : PostgreSQL réel
```

Le fichier `engine` ne touche pas la base (hors assertion L0-05) et a aussi été rejoué hors CI. **Un test rouge est une faille** : aucun test n'est marqué `skip` ni adapté pour passer.

## Synthèse

| Mesure                             | Valeur                                         |
| ---------------------------------- | ---------------------------------------------- |
| Scénarios joués (groupes ARG-xx)   | 21                                             |
| Scénarios entièrement bloqués      | 16                                             |
| Scénarios avec au moins une faille | 5                                              |
| Failles distinctes (tests rouges)  | 9                                              |
| Racines de faille                  | 5                                              |
| Tests écrits                       | 121 (dont 1 ignoré : TJ10c n'existe qu'en PYG) |
| Dont rouges (failles)              | 16                                             |

Les 16 tests rouges viennent de 9 attaques : 7 jouées en PA et en PY, ARG-33c en PY seul (TJ10c n'existe qu'en PYG) et ARG-04c une seule fois (moteur pur). Les vecteurs **T36, TJ01, TJ02b** (et TJ08a/b côté PY) **restent verts** : ARG-05 et ARG-06 les rejouent, en plus des suites existantes (`pnpm test:money`, `l0-stl-settlement`, `l0-pay-marketplace`).

## Failles (gravité PROPOSÉE, parade suggérée)

### RC-1 — Les montants d'un règlement ne sont liés ni aux entrées ni à une recomputation (élevée)

`settlement_cmd_record` et `settlement_assert_balanced` (0027) vérifient des **égalités internes** à la charge utile (Σ jambes, HOST = `host_from_guest_minor` de l'en-tête, base = capture). Aucune ne relie les montants à `inputs`, dont seul l'empreinte est contrôlée contre `inputs` lui-même. Un travailleur `settlement` (compromis, ou un bogue de l'appelant) peut donc écrire n'importe quel règlement **cohérent**. Limite connue de l'ADR-057 (« une redistribution entre jambes passe ici »), mais le rejeu des entrées n'est exigé par aucune garde en base.

| Id      | Attaque jouée                                                                                                                                                  | Résultat                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ARG-23b | 100 unités mineures déplacées de PLATFORM vers HOST (jambes, `host_from_guest`, `host_earnings`, `platform_net` ajustés ensemble), état capturé tenu, PA et PY | **FAILLE** : acceptée                                                                            |
| ARG-23c | Montants du règlement T03 (T27) avec les `inputs`, l'empreinte et `param_snapshot_hash` du règlement T05 (T41)                                                 | **FAILLE** : acceptée                                                                            |
| ARG-23e | Charge utile cohérente ×10 (total payé, remboursement, jambes, base) sans état capturé tenu                                                                    | **FAILLE** : acceptée (`Σ base = total payé` est satisfait par la charge utile elle-même)        |
| ARG-04c | Moteur : version n+1 calculée sur un devis recomposé à total égal (1 000 déplacés de `tripPrice` vers `tripFee`)                                               | **FAILLE** : `buildSettlementRecord` rend une v2 ; seul le total payé est comparé à la version n |

Gravité proposée : **élevée** avant tout ordre réel (le règlement décide des jambes HOST et PLATFORM : un déplacement de valeur reste invisible des contrôles d'équilibre). Elle tombe à moyenne tant qu'aucun ordre autre que `PLANNED` n'existe (ADR-057, lot 0).

Parades suggérées :

1. Un **second calcul indépendant** (rejeu des `inputs` par le moteur dans une tâche FIN, ou par l'oracle) devient une condition d'activation de tout ordre : colonne `verified_at` / `outputs_hash` du règlement, ordre refusé tant que le rejeu n'a pas confirmé les montants.
2. Persister un `outputs_hash` calculé par le moteur et le comparer au rejeu.
3. Moteur : conserver dans le record le haché du devis figé (`trip` canonique) et refuser une version n+1 dont le `trip` diffère de celui de la version n (ARG-04c) ; comparer aussi `previous.inputs` au `trip` reçu.
4. v1 sans état capturé tenu : refuser (`settlement_capture_missing`) comme pour la v2, ce qui ferme ARG-23e.

### RC-2 — Les ordres de remboursement ne sont rattachés à aucune version de règlement (élevée)

`payment_payment_operation` ne porte ni identifiant ni version de règlement. `settlement_cmd_apply_leg_movement` borne un remboursement par le **solde de la jambe** (capturé − remboursé − libéré), jamais par `guest_refund_minor` ni par les jambes de la variation du règlement.

| Id      | Attaque jouée                                                                                                                                                      | Résultat                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| ARG-33b | v1 enregistré (T03, T27), remboursement exact appliqué, puis **second remboursement sous une autre clé** égal au retenu : Σ remboursée = tout le capturé, PA et PY | **FAILLE** : appliqué                                     |
| ARG-33c | PY (J, TJ10) : remboursement ventilé **au prorata** (jambes de TJ10c, même total que TJ10b) au lieu des jambes explicites du règlement                             | **FAILLE** : appliqué (HOST −568 536 au lieu de −500 001) |

Gravité proposée : **élevée** (remboursement du voyageur au-delà du règlement, scénario « supersession qui double un remboursement » du critère 2, 08 E7 règle 1 « jamais un prorata »). Un travailleur `payment_command` fautif suffit.

Parades suggérées :

1. Colonnes `settlement_id` et `settlement_version` (NOT NULL pour REFUND / LEG_REALLOCATION / LEG_RELEASE dans le périmètre loyer) sur l'opération ou sur `settlement_leg_movement`.
2. Dans `cmd_apply_leg_movement` : pour un REFUND, vérifier jambe par jambe `Σ remboursé ≤ −Σ variations de la dernière version` et que la version citée est la tête de chaîne ; un ordre issu d'une version remplacée est refusé.
3. Montants d'ordre = jambes de variation du règlement citée (égalité exacte, pas une borne), ce qui interdit le prorata d'un PSP ou d'un appelant.

### RC-3 — Aucune garde de fin de trajet ni d'interrupteur sur le versement de la jambe HOST (élevée)

| Id      | Attaque jouée                                                                                                                          | Résultat                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ARG-34b | `LEG_RELEASE` de la jambe HOST (PA et PY) sur un trip **BOOKED**, fin planifiée dans le futur, `payouts_enabled` = false (graine 0009) | **FAILLE** : opération enregistrée, SUCCEEDED, `released_minor` de HOST = capturé |

`payouts_enabled[pays]` (et `funds_holding_enabled`) n'est lu par **aucune** fonction SQL (le seul rempart de détention de fonds est le CHECK `psp_account_platform_mor_closed`). Le module PYO, qui doit porter « aucun versement si `payouts_enabled` = false » (README PYO), est une coquille : la garde n'existe donc nulle part. `trip_leg_balance.release_at` n'est lu par personne.

Gravité proposée : **élevée**. Mise en service par pays (CLAUDE.md contrainte 7) : l'interrupteur doit être une garde **en base**, pas une promesse de module.

Parades suggérées : dans `payment_cmd_record_operation` (et `cmd_apply_leg_movement`) pour `LEG_RELEASE` et tout versement à l'hôte : exiger `payouts_enabled[pays]` = true (lecture fail-closed de `config`), statut du trip terminal (COMPLETED ou équivalent) et `now() ≥ release_at`, jambe non gelée, sous-marchand `ACTIVE`. Écrire le test inverse (cas passant) dans la même story.

### RC-4 — Aucune borne du montant encaissé sur le devis accepté (moyenne, bêta)

| Id      | Attaque jouée                                                                                          | Résultat               |
| ------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| ARG-34a | `CAPTURE` de 4 × 10^15 unités mineures sur un trip réservé, portée sur les soldes par jambe (PA et PY) | **FAILLE** : appliquée |

`booking_hold_payment_terms` est volontairement fail-closed (aucune ligne avant le module PRC), mais le chemin « trip » de `payment_cmd_record_operation` n'a aucun plafond : le total capturé n'est comparé ni à un devis ni à un prix du trip. Gravité proposée : **moyenne** tant que PRC n'existe pas ; **à fermer par la story du devis (module PRC)** : total encaissé ≤ montant figé du devis accepté, par jambe.

### RC-5 — Une preuve « signée » peut être déclarée sans webhook (moyenne)

| Id     | Attaque jouée                                                                                                                | Résultat                                                                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ARG-36 | `payment_cmd_apply_operation_status(op, 'SUCCEEDED', 'WEBHOOK', NULL, NULL)` par le travailleur qui a enregistré l'opération | **FAILLE** : `APPLIED`, `status = SUCCEEDED`, `proof_type = WEBHOOK_SIGNED`, sans ligne dans `webhook_inbox` |

Le même travailleur peut créer l'opération, la marquer réussie et la porter sur les soldes (`apply_leg_movement`). Gravité proposée : **moyenne** (défense en profondeur ; le travailleur est de confiance). Parade : `proof_type = WEBHOOK_SIGNED` exige `p_raw_ref` référençant une ligne de l'inbox `signature_valid` et `RECEIVED` du même compte et de la même référence PSP ; `POLL` exige une lecture `getOperation` tracée ; séparation des rôles entre enregistrement et certification.

## Scénarios joués et bloqués

| Id        | Attaque                                                                                                                                                                                                                                                                                         | Rejouer                            | Résultat                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------- |
| ARG-01    | Arrondi PYG et USD : demi-unités, négatifs, > 2^53, 12 cas à la main + balayage −50…4 000 × 7 parts ; `allocHost` = formule de 08, hôte + plateforme = montant ; taxe par ligne (T43 : 1,40)                                                                                                    | `redteam-argent-engine` ARG-01     | bloqué                     |
| ARG-02    | Débordement bigint : int64 ± 1, `add`, `negate(MIN)`, `multiplyByInteger`, `multiplyRoundHalfUp`, chaînes hostiles, 2^53, trip dont Σ lignes > int64                                                                                                                                            | `redteam-argent-engine` ARG-02     | bloqué                     |
| ARG-03    | Devise croisée (ligne, taxe, total, barème de pénalité PYG sur trip USD, version n+1 d'une autre devise), `Money` forgé (objet simple, clone du prototype)                                                                                                                                      | `redteam-argent-engine` ARG-03     | bloqué                     |
| ARG-04a/b | Montant modifié : total payé ≠ Σ lignes + taxe ; version n+1 sur un total différent                                                                                                                                                                                                             | `redteam-argent-engine` ARG-04     | bloqué                     |
| ARG-05    | Supersession : T36 (valeurs de l'oracle), v3 = événement de v2 rejoué (variation nulle), chaîne de 4 versions (capture + Σ variations = dernière version, Σ = − remboursement), rejeu déterministe                                                                                              | `redteam-argent-engine` ARG-05     | bloqué                     |
| ARG-06    | Vecteurs TJ01 / TJ02b (PA) et TJ08a / TJ08b (PY) : jambes explicites                                                                                                                                                                                                                            | `redteam-argent-engine` ARG-06     | vert                       |
| ARG-07    | Fuzz 1 500 règlements PYG + 1 500 USD (restes d'allocation) : équilibre, Σ jambes, jambes ≥ 0, taxe remboursée ≤ payée, `platform_net`                                                                                                                                                          | `redteam-argent-engine` ARG-07     | bloqué                     |
| ARG-20    | Règlement rejoué (même identifiant, nouvel identifiant) ⇒ `SETTLEMENT_EXISTS`, une ligne                                                                                                                                                                                                        | `redteam-argent-settlement` ARG-20 | bloqué                     |
| ARG-21    | EC-54 : 6 connexions posent v1 puis v2 en même temps (committé) : un gagnant par version, les autres `SETTLEMENT_EXISTS`                                                                                                                                                                        | `redteam-argent-settlement` ARG-21 | bloqué                     |
| ARG-22    | v2 rejouée comme v3, v3 qui saute v2, v2 en double, v3 légitime nulle ; Σ variations de la chaîne = jambes de la dernière version                                                                                                                                                               | `redteam-argent-settlement` ARG-22 | bloqué                     |
| ARG-23a/d | HOST + X seul ⇒ `SETTLEMENT_UNBALANCED` ; total ×10 avec état capturé tenu ⇒ `INVARIANT_VIOLATION`                                                                                                                                                                                              | `redteam-argent-settlement` ARG-23 | bloqué                     |
| ARG-24    | 21 charges utiles hostiles : 2^63, négatifs, notation scientifique, décimaux, hexadécimal, jambe dupliquée / inconnue / absente, ligne dupliquée, format, nature, version du moteur, empreinte altérée, devise minuscule ou inconnue                                                            | `redteam-argent-settlement` ARG-24 | bloqué, 0 ligne écrite     |
| ARG-25    | Devise croisée : règlement PYG sur trip PA, USD sur trip PY                                                                                                                                                                                                                                     | `redteam-argent-settlement` ARG-25 | bloqué                     |
| ARG-26    | `settlement_cmd_record` appelée par `app_api`, `app_anon`, autres travailleurs, sans contexte ⇒ 42501 ; UPDATE / DELETE / TRUNCATE / INSERT directs des règlements, jambes, soldes, mouvements ⇒ 42501                                                                                          | `redteam-argent-settlement` ARG-26 | bloqué                     |
| ARG-30    | Jambes falsifiées : Σ ±1, négatif compensé, décimal, `5e2`, `+500`, espace, hexadécimal, vide, 19 chiffres, nombres JSON, null, jambe manquante / en trop / en minuscules, `legs` null / tableau / chaîne ; montant 0, négatif, hors bigint ; écriture directe des jambes ou du montant ⇒ 42501 | `redteam-argent-psp-legs` ARG-30   | bloqué, 0 opération écrite |
| ARG-31    | Clé d'idempotence réutilisée : montant + 1, même total autre répartition, autre trip, autre nature, autre objet, autre tentative ⇒ `IDEMPOTENCY_CONFLICT` ; rejeu identique ⇒ même opération ; clé de l'autre pays ⇒ conflit                                                                    | `redteam-argent-psp-legs` ARG-31   | bloqué                     |
| ARG-32    | USD sur un trip PY, PYG sur un trip PA, compte d'un autre pays ⇒ `PAYMENT_SUBJECT_MISMATCH`                                                                                                                                                                                                     | `redteam-argent-psp-legs` ARG-32   | bloqué                     |
| ARG-35    | Détention de fonds : compte `PLATFORM_MOR`, FAKE en LIVE, bascule vers `PLATFORM_MOR`, compte réel ACTIVE sans porte PAY-041 refusés ; FAKE « en production » (C19) : opération et compte refusés                                                                                               | `redteam-argent-psp-legs` ARG-35   | bloqué                     |

Contrôles positifs inclus (la commande reste utilisable) : remboursement exact aligné sur le règlement (ARG-33a), jambes exactes (ARG-30), v3 légitime (ARG-22).

## Scénarios vérifiés seulement par lecture — **non exécuté**

- **Montant modifié entre devis et capture, côté hold** : `booking_hold_payment_terms` est un corps fail-closed (aucune ligne), donc `booking_cmd_start_payment` ne peut pas être exécuté avec un devis. À jouer avec la story PRC ; voir RC-4.
- **Webhook FAKE rejoué ou falsifié, FAKE dans l'image de production** : relèvent de l'axe concurrence ; ici seule la garde SQL C19 (compte et opération) est jouée (ARG-35).
- **Adaptateur FAKE du PSP** (`packages/fake-adapters`, mode hostile `prorata`) : lu, couvert par ses propres tests ; non rejoué.
- **Idempotence côté règlement** : `settlement_cmd_record` n'a pas de clé d'idempotence ; un rejeu après commit perdu reçoit `SETTLEMENT_EXISTS` et non le règlement existant. Ce n'est pas une faille d'argent (aucun doublon), mais l'appelant devra lire l'existant avant de retenter. Observation, gravité faible.
- **Frais PSP, chargeback, bordereau assureur, avance de Kmino** (0036) : hors périmètre des scénarios imposés, non attaqués.

## Notes de méthode

- PostgreSQL local non démarré (règle du brief) : les tests de base ne tournent qu'en CI ; le fichier `engine` a été exécuté localement (19 verts, 1 rouge = ARG-04c) et le typecheck / lint / Prettier passent en local.
- CI du SHA publié : 771 tests verts, 16 rouges (exactement RC-1 à RC-5), 2 ignorés. Une première exécution avait montré un défaut de **mon** banc (ARG-26, `app_anon` n'a pas accès à `platform.now()` de `withTestTransaction`) : corrigé, ce n'était pas une faille.
