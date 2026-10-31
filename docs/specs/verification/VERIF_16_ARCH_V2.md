# VERIF_16 — Revérification indépendante de 17_DATA_MODEL_AND_ARCHITECTURE.md (v2)

Auditeur indépendant (concurrence de base de données, paiements, sécurité). Fichiers revus, non modifiés : `17_DATA_MODEL_AND_ARCHITECTURE.md` (v2), `08_BUSINESS_RULES.md` (source de vérité de l'argent), `04_FEATURE_INVENTORY.csv`, `18_MVP_AND_ROADMAP.md`, audit précédent `verification/VERIF_14_ARCHITECTURE.md`. Périmètre prioritaire : §2.5 (conversion hold → trip, plan de test C1–C12), §4.3, §10, changements de sécurité (RLS, tests inter-agences, crypto-shredding, biométrie), modèle de change.

Limites d'exécution, dites une fois : **aucun PostgreSQL n'est installé sur le poste** (ni `psql`, ni Docker) ; le DDL du §4 ci-dessous n'a donc **pas été exécuté**. Il est vérifié par lecture de la documentation PostgreSQL et par raisonnement. Les comptes de la coupe Bêta viennent d'un script Python (`python -I`) lisant `04_FEATURE_INVENTORY.csv` et §10.

---

## 0. Synthèse et verdict

**Verdict : GO CONDITIONNEL (acceptable avec réserves).** Le défaut CRITIQUE de VERIF_14 (F1, double réservation silencieuse à la conversion) est **réellement corrigé** : la conversion verrouille le hold, réécrit `active = true` (ce qui force la réévaluation de la contrainte d'exclusion), ré-acquiert sous `SAVEPOINT` si le hold a expiré, compense sinon, et l'expiration saute les holds verrouillés. J'ai déroulé huit entrelacements (§2) : le cœur tient. Il reste **0 CRITIQUE, 5 MAJEUR, 14 MINEUR** (nouveaux). Les 5 MAJEUR sont des ajouts de spécification, pas une refonte :

| # | Gravité | Constat | Où |
|---|---|---|---|
| N1 | MAJEUR | Un événement de paiement tardif **après** le début d'une compensation peut convertir le hold en trip alors qu'un remboursement est déjà lancé (trip `BOOKED` et paiement rendu). Aucun test ne le détecte | §2.5 étapes 4.1, 5 ; C6, C11 |
| N2 | MAJEUR | Deuxième paiement réussi sur un même hold (lien de paiement réutilisable, double clic, tentatives 2 et 3) : renvoyé « trip existant », argent non suivi | §2.5 étape 4.1 ; `hold_compensation` |
| N3 | MAJEUR | Fenêtres de perte de créneau **après paiement** créées par l'ordre des opérations : `PAYMENT_IN_FLIGHT` posé après l'appel PSP, mise à jour non conditionnelle, libération immédiate d'un hold dont l'ordre PSP n'est pas annulable (Yappy) | §2.5 étapes 3, 6 |
| N4 | MAJEUR | La RLS « `org_id = app.org_id` » est incompatible avec les invariants **par guest, inter-agences** (2 holds, 1 `AGENCY_LINK`, `GUEST_OVERLAP`) et avec la lecture publique du catalogue : soit les limites sont contournables, soit un rôle privilégié est nécessaire, et il n'est pas spécifié | §2.3, §6.6, §2.5 |
| N5 | MAJEUR | Coupe Bêta : les éléments « non négociables » du §10 (moteur de règlement et tests dorés, conversion gardée + fuzz, RLS, crypto-shredding, `manual_action` à commandes réelles) **ne sont pas dans les 76 lignes** ni dans le barème 8–14 semaines de 04/18 ; 84 à 88 tables construites, pas ≈ 60 | §10 ; 04 ; 18 §5 |

Contrôles positifs : 16 vérifications croisées de statuts `beta_pilote` citées en §10 (PAY-033, PAY-034, PAY-021, FIN-001, FIN-018, PAY-035, VER-001, NTF-007, TRP-004, PRC-001, BKG-019, VER-004, PAY-041, SRC-002, CAL-009, PAY-006) : **16/16 exactes** vs 04 ; 18 OUI + 58 SIMPLIFIÉ = 76, 59 MANUEL, 12 DIFFÉRÉ : exact ; aucun identifiant inconnu ; invariants §4.3 conformes à 08 E1/E2 après VERIF_12 (point par point au §6).

---

## 1. Revérification des constats CRITIQUE / MAJEUR de VERIF_14

| VERIF_14 | Gravité | Vraiment corrigé ? | Réserve résiduelle |
|---|---|---|---|
| F1 conversion HOLD → TRIP | CRITIQUE | **Oui.** `UPDATE … SET kind='TRIP', active=true, expires_at=NULL WHERE kind='HOLD'` sous `FOR UPDATE` du hold ; `SAVEPOINT` + `23P01` ; 2a ne désactive que `kind='HOLD'` ; I-OCC par trigger différé + oracle. Bug d'origine impossible à reproduire dans les entrelacements du §2 | N1, M3, M4 |
| F2 course expiration / paiement | MAJEUR | **En grande partie.** `PAYMENT_IN_FLIGHT`, borne 20 min, garde `hold_ttl ≥ ORDER_TTL + marge`, compensation par capacité | N3 (ordre des opérations), M5 |
| F3 `guest_occupancy` / `checkout_hold` | MAJEUR | **Oui** (`guest_occupancy` = trips ; 2a met à jour hold + occupation ; expiration ciblée sur le guest). Le volet « guest » de 2a n'est qu'un commentaire SQL (`-- puis : h.guest_user_id = $guest`) | M14 |
| F4 mode lien A8 | MAJEUR | **Oui** : hold `AGENCY_LINK`, pas de trip impayé, SM-1 et PAY-033 intacts. Décision de TTL toujours ouverte (UXQ-09) ; changements 04/08 non appliqués (C04-1/2, C08-2) | M13, N4 |
| F5 paiement avant trip | MAJEUR | **Oui** (`hold_id`, FK nullables, `payment_operation_link`, clé par tentative). Format E4 à reporter dans 08 (C08-8) | — |
| F6 `collected_total` | MAJEUR | **Oui** (`purpose`, agrégats séparés, §4.3.1) | — |
| F7 invariants §4.3 | MAJEUR | **Oui**, conforme à 08 E1/E2 (§6) | M7 |
| F8 remboursement exécuté par l'agence | MAJEUR | **Oui** (`executor`, `agency_refund_task`, rails P0-A, `CREDIT_CASH` désactivé) | M7 |
| F9 `refund_instance` hors règlement | MAJEUR | **Oui** (`origin_type/origin_id`, `settlement_id` nullable, `hold_id`) | — |
| F10 multi-devises | MAJEUR | **Oui sur le fond** (deux montants, taux exact, paire d'écritures) | M8 |
| F11 capacités PSP | MAJEUR | **Oui** (11 capacités ajoutées, fail-closed vérifié dans la table §2.8) | — |
| F12 identifiants PSP | MAJEUR | **Oui** (mandat, travailleur, journal d'usage, révocation, `psp_consent_ref`) | — |
| F13 RBAC / RLS | MAJEUR | **Partiellement** : permissions et accès liés au dossier : oui ; RLS « obligatoire » : principe oui, **conception incomplète** | N4, M9 |
| F14 effacement / immuable | MAJEUR | **Oui sur le principe** (clé par sujet, chaîne sur chiffré) | M10 |
| F15 biométrie | MAJEUR | **Oui** (zéro copie, scores C3, défaut le plus court) | M10 (`evidence_file_ids`), M12 |
| F16 coupe Bêta | MAJEUR | **Structure oui, chiffrage non** | N5, M11 |

---

## 2. §2.5 : entrelacements concrets

Notation : V = véhicule, créneau S ; A et B = deux guests ; HA/HB = holds ; OA/OB = lignes `vehicle_occupancy` ; W = travailleur de conversion ; « job » = tâche d'expiration de 60 s ; horloge = celle de la base (`now()`). `hold_ttl` = 10 min, en vol borné à 20 min.

### 2.1 Tâche d'expiration contre conversion (cas du plan C2 et C3) : **tient**

Variante a, la conversion prend le verrou en premier :

| t | Acteur | Action | État |
|---|---|---|---|
| 10:09:58 | W | `BEGIN` ; `SELECT … FROM checkout_hold WHERE id=HA FOR UPDATE` | HA `PAYMENT_IN_FLIGHT`, verrouillé |
| 10:10:01 | job | `due` : `expires_at <= now()` mais `SKIP LOCKED` saute HA | HA intact |
| 10:10:02 | W | `UPDATE OA SET kind='TRIP', active=true…` ; trip, lien, `CONVERTED` | — |
| 10:10:02 | W | `COMMIT` ; trigger différé I-OCC vérifie `OA.active` | trip `BOOKED`, OA active |

Variante b, le job a validé avant : W bloque sur `FOR UPDATE` (le job détient le verrou), puis, après le `COMMIT` du job, relit la ligne en `READ COMMITTED` : statut `EXPIRED` (le `SELECT` n'a pas de prédicat de statut, ce qui est la bonne forme) ⇒ ré-acquisition sous `SAVEPOINT`, succès si aucun concurrent. **Conforme.**

### 2.2 Deux guests, hold de A expiré puis ré-acquis par B, preuve de A ensuite (C4) : **tient** ; une variante concurrente est sous-spécifiée

Séquentiel :

| t | Acteur | Action |
|---|---|---|
| 10:00 | A | HA `ACTIVE`, OA `[S)` active, expire 10:10 |
| 10:10:05 | job | HA `EXPIRED`, OA `active=false` (`HOLD_EXPIRED`) |
| 10:10:30 | B | 2a ne trouve rien à expirer ; insère HB + OB active : accepté |
| 10:12 | W(A) | `FOR UPDATE` HA = `EXPIRED` ; `SAVEPOINT` ; `UPDATE OA SET active=true` ⇒ **`23P01`** (OB active) ; `ROLLBACK TO SAVEPOINT` ; `hold_compensation` ; `COMMIT` |
| 10:13 | W(B) | conversion normale de HB |

Résultat conforme : un seul trip, A compensé.

Variante concurrente (même instant, 10:12:00) : W(A) réécrit `OA.active=true` (tuple non validé) pendant que B insère OB. Dans PostgreSQL, deux écritures concurrentes dans un index d'exclusion qui se voient mutuellement non validées **s'attendent l'une l'autre** : le détecteur d'interblocage tranche après `deadlock_timeout` (1 s par défaut) et annule l'une avec `40P01`. Cela n'est pas documenté dans 17 : (i) le p95 « création de hold < 300 ms sous contention » de C1 est à risque ; (ii) la conversion annulée par `40P01` doit être **rejouée**, ce que ni §2.5 ni §4.4 ne spécifient pour le travailleur. Correctif (M2) : verrou consultatif par véhicule avant toute écriture d'occupation.

Équité : A a payé, B n'a rien payé, et c'est A qui est remboursé. C'est cohérent avec la règle écrite, coûteux en opérationnel (M13).

### 2.3 Webhook reçu deux fois : **tient** pour la même opération, **échoue** après compensation (N1, N2)

Doublon exact : `UNIQUE NULLS NOT DISTINCT (provider, compte, dedup_key)` ⇒ 200 sans traitement. Si le PSP n'a pas d'identifiant d'événement, `dedup_key = sha256(corps)` : un renvoi dont l'horodatage change dans le corps **passe** la déduplication ; il atteint l'étape 4.1, qui répond « trip existant » si `CONVERTED` : **correct**. Le défaut apparaît quand le hold n'est pas `CONVERTED` (§2.4) ou quand l'opération est une **autre** opération (§2.7).

### 2.4 Webhook arrivant après le début d'une compensation : **N1, MAJEUR**

| t | Acteur | Action | État |
|---|---|---|---|
| 10:12:00 | W | événement E1 pour l'opération P (guest A) : HA `EXPIRED`, ré-acquisition refusée (`23P01`, HB de B actif) ; ligne `hold_compensation` HC (`OPEN`, action remboursement) | HA reste `EXPIRED` ; remboursement de P lancé |
| 10:21:00 | job | HB de B expire sans paiement ; créneau libre | OB inactive |
| 10:22:00 | W | événement E2 pour la **même** opération P (confirmation de l'agence, ou second webhook avec un autre `dedup_key`) : `FOR UPDATE` HA = `EXPIRED` ⇒ ré-acquisition **réussit** ; trip `BOOKED` créé, `CONVERTED` | **trip `BOOKED` et remboursement de P en cours** |

Rien dans 4.1 ne regarde `hold_compensation` ; l'unicité `(hold_id, operation_id)` empêche seulement une seconde compensation. Les invariants de C11 sont tous vrais ici : pas de chevauchement, I-OCC vrai, paiement « rattaché à un trip **ou** à une compensation » (il est les deux), preuve de paiement présente. Le test ne peut donc pas voir l'anomalie. Correctif : poser `checkout_hold.status = 'COMPENSATED'` (terminal) dans la même transaction que la création de `hold_compensation` ; en 4.1, toute preuve sur un hold `COMPENSATED` est journalisée et ignorée ; invariant de test : « une opération est rattachée à un trip **XOR** à une compensation » ; nouveau test C13 (événement tardif sur hold compensé, créneau redevenu libre).

### 2.5 Paiement Yappy après libération du véhicule : **tient** pour le créneau, **coûteux**, cause en amont (N3)

| t | Acteur | Action |
|---|---|---|
| 10:00:00 | A | HA ; ordre Yappy O (TTL 5 min) ⇒ HA `PAYMENT_IN_FLIGHT`, `payment_in_flight_until` = 10:06:00 |
| 10:03:00 | A | quitte la page : libération (étape 6) ⇒ HA `RELEASED`, OA inactive ; `SUPPORTS_ORDER_CANCEL` inconnu pour Yappy ⇒ **ordre non annulé** |
| 10:04:00 | B | pose HB sur S : accepté (HA libéré malgré l'ordre vivant) |
| 10:04:30 | A | approuve dans l'application Yappy ; IPN (GET à hash, non signé) à 10:04:40 |
| 10:04:50 | W | confirmation par `getOperation` ; HA `RELEASED` ⇒ ré-acquisition refusée ⇒ compensation Yappy : `agency_refund_task` rail `AGENCY_TRANSFER`, choix du rail par le guest (SM-8), **5 jours ouvrés** |

Le comportement est conforme au texte, mais il fabrique une compensation de 5 jours ouvrés à partir d'une action banale (retour arrière). La règle qui manque : **sans** `SUPPORTS_ORDER_CANCEL` validé, une libération volontaire ne libère pas le créneau avant `payment_in_flight_until` (libération « douce »).

### 2.6 Panne du PSP en cours de conversion : **tient** pour la base, trous en amont et en aval

- La conversion est une transaction de base pure (aucun appel externe dans le verrou ; `getOperation` est appelé **avant**, comme le montre le diagramme §4.4) : une panne PSP ne laisse aucun état partiel. **Conforme.**
- Panne **entre le paiement et le webhook** : aucune preuve ; à 10:20 le job expire HA ; le webhook rejoué par le PSP à 11:30 passe par la ré-acquisition ; si le créneau est libre, le trip est créé **plus d'une heure après** que le guest a lu « no se confirmó tu pago ». Il n'y a pas d'interrogation active (`getOperation`) à l'échéance de `payment_in_flight_until` ; seul le rapprochement de nuit existe. En mode (b) Bêta, aucun `getOperation` n'est possible (pas d'identifiants) : voir M7.
- Panne **pendant la compensation** : commande `VOID` ou remboursement ⇒ `UNKNOWN`, même clé, `getOperation`, escalade à `unknown_escalation_minutes` (30) : conforme à §4.3.
- Panne **pendant l'appel synchrone `createHostedPayment`** (étape 3) : voir N3 (cas c).

### 2.7 Deuxième paiement réussi sur un même hold : **N2, MAJEUR**

Jusqu'à 3 tentatives (`payment_attempts_per_hold`), ou un lien de paiement **réutilisable** (cas fréquent des liens PSP génériques, donc de la Bêta, où le lien est « saisi par l'agence »), ou un double clic : deux opérations `SUCCEEDED` pour un hold. Le premier événement convertit ; pour le second, 4.1 répond « trip existant ». La seconde opération n'est ni compensée ni rattachée ; elle gonfle `collected_total` si elle est liée au trip par `payment_operation_link`, ou reste orpheline. Aucun motif de `hold_compensation.reason` (`SLOT_LOST_AFTER_EXPIRY`, `SLOT_LOST_AFTER_RELEASE`, `GUEST_OVERLAP`, `INVARIANT_VIOLATION`) ne convient. Correctif : motif `DUPLICATE_PAYMENT` ; en 4.1, vérifier que l'opération reçue **est** l'opération de conversion, sinon compensation totale ; contrôle « montant = devis » (4.2) étendu à « une seule opération de loyer par hold ».

### 2.8 Désynchronisation d'horloge entre serveurs applicatifs et base : **horloge faisant foi non déclarée (M1)**

Le texte écrit `now()` dans le SQL de 2a et dans `expires_at = now() + ttl`, donc la base est l'horloge de fait. Mais :

1. Rien ne dit que les serveurs applicatifs ne doivent **jamais** calculer ni comparer un instant d'expiration. `payment_in_flight_until = min(now() + ORDER_TTL + marge, created_at + 20 min)` : calculé dans le SQL ou dans l'application ? Avec une application **3 min en retard** : ordre créé à la minute 9 ⇒ `in_flight_until` = minute 12 au lieu de 15 ; Yappy (TTL 5 min) payé minute 13, valide chez le PSP ⇒ hold expiré ⇒ compensation. La marge `payment_in_flight_margin_s` = 60 s est inférieure à toute dérive plausible.
2. `now()` est l'instant de **début de transaction** : une transaction qui attend un verrou consultatif calcule `expires_at` avec un instant périmé (le hold vit un peu moins) ; la comparaison `expires_at <= now()` de 2a est, elle, prudente. Utiliser `statement_timestamp()` ou `clock_timestamp()` et le dire.
3. L'horloge du PSP court à partir de la **réception** de l'ordre ; `in_flight_until` est posé après la réponse : sens prudent. Mais le PSP applique son propre TTL avec sa propre horloge ; la marge doit couvrir la latence réseau et la dérive PSP, mesurée en bac à sable.
4. La tolérance de signature de ±5 min (§4.4 point 2) compare l'horodatage du PSP à l'horloge **applicative** : une dérive de plus de 5 min rejette tous les webhooks (`REJECTED_SIGNATURE`), donc coupe la voie de preuve.
5. Le plan de test annonce « horloge virtuelle injectée » sur un PostgreSQL réel : ce n'est pas possible tant que le SQL appelle `now()`. Il faut une fonction `platform.now()` (lisant un paramètre de session seulement en test) utilisée partout, ou des tests qui réécrivent `expires_at`.

Règle à écrire : **l'horloge de la base est seule autorité** pour tout instant d'expiration ; les applications ne passent jamais d'« heure courante » ; surveillance NTP/chrony de la dérive des applications avec alerte à 30 s (pour la tolérance de signature).

---

## 3. Constats détaillés

### N1 — MAJEUR — Preuve tardive sur un hold déjà compensé
Voir §2.4. Gravité : un paiement est à la fois remboursé et converti en trip ; en mode (b) c'est l'agence qui exécute le remboursement : elle rend l'argent d'un trip qu'elle doit honorer.

### N2 — MAJEUR — Plusieurs paiements pour un seul hold
Voir §2.7.

### N3 — MAJEUR — Ordre des opérations de l'étape 3 et de l'étape 6
(a) L'étape 3 écrit `PAYMENT_IN_FLIGHT` **après** la réponse du PSP. Entre la création de l'ordre et cette écriture, la protection n'existe pas : un appel PSP de 30 s à la minute 9:50 laisse le job expirer HA ; l'écriture suivante (si elle est inconditionnelle) remet `EXPIRED` en `PAYMENT_IN_FLIGHT` sur une occupation inactive : le guest est redirigé pour payer un créneau qui n'est plus retenu. (b) Un plantage entre l'ordre PSP et l'écriture laisse un ordre vivant sans protection. Correctif : poser `PAYMENT_IN_FLIGHT` (avec une borne provisoire = `now() + timeout PSP + marge`) **avant** l'appel, `UPDATE … WHERE status = 'ACTIVE'` (zéro ligne ⇒ ne pas appeler le PSP), puis affiner la borne avec le TTL réel de l'ordre. (c) Étape 6 : voir §2.5 (libération douce sans annulation d'ordre).

### N4 — MAJEUR — RLS par organisation contre invariants par guest
La politique spécifiée est `USING (org_id = current_setting('app.org_id')::uuid)`, appliquée avec `SET LOCAL app.org_id` par transaction. Or :
- « 2 holds vivants par guest », « 1 `AGENCY_LINK` par guest **toutes agences confondues** » et `GUEST_OVERLAP` portent sur des lignes de **plusieurs** organisations. Sous RLS fail-closed, la requête voit les lignes de l'agence courante seulement : **la limite est contournable** (2 holds par agence, donc 2 × N). Ou bien elle s'exécute sous un rôle privilégié qui contourne la RLS, ce que (2) du texte ne prévoit que pour les « travailleurs internes ».
- Le guest n'appartient à aucune organisation : ni la lecture de ses propres trips, ni l'insertion d'un `HOLD` sur le véhicule d'une agence tierce (`WITH CHECK` org) ne passent par la politique décrite. `app.actor_id` est posé mais aucune politique `guest_user_id = app.actor_id` n'est écrite.
- Recherche publique : les lignes d'annonces publiées doivent être lisibles par tous (politique sur statut), non spécifiée.
Correctif : politiques par type d'acteur (agence : `org_id` ; guest : `guest_user_id` ; public : colonnes et statuts publiables ; staff : dossier assigné), vérifications inter-agences dans de **petites fonctions `SECURITY DEFINER`** minimales et auditées (propriétaire distinct, `search_path` figé), `security_invoker = true` sur les vues (RPT).

### N5 — MAJEUR — Coupe Bêta : cohérente avec 04, non tenable au barème
Comparaison script (04 `beta_pilote`, §10, 18 §5) :

| Contrôle | Résultat |
|---|---|
| OUI / SIMPLIFIÉ / MANUEL / DIFFÉRÉ | 18 / 58 / 59 / 12 ; 76 construites : **identique** à §10 et 18 §1.0 |
| Statuts des lignes citées en §10 | 16 contrôlées, 16 exactes ; 70 identifiants cités, aucun inconnu (ADR-xxx exclus) |
| Lignes construites nommées en §10 | **20 sur 76** (les 56 autres, dont BKG-014 et CAL-011 qui portent l'anti-double-réservation, ne sont rattachées que par module : pas de table lignes → tables) |
| Complexité des 76 lignes | 33 faible, 37 moyenne, 6 élevée |
| Lots 04 des 76 lignes | lot 0 : 11 ; lot 1 : 18 ; lot 2 : 38 ; lot 3 : 8 ; lot 4 : 1 |
| Tables « construites » | **84 noms distincts** dans la colonne « Construit » (+ `outbox_event`, `inbox_receipt`, `dead_letter`, `scheduled_job` absents du tableau mais exigés par §4.2 « outbox et pg-boss oui » = **88**) contre « ≈ 60 » annoncé ; 133 entités en §3.2, donc « ≈ 130 » exact |
| Ports | 5 lignes de tableau (6 avec `UploadScanner`), « 6 sur 15 » plausible ; le total de 15 n'est pas recomptable dans le document |

Incohérences de périmètre :
1. **Moteur de règlement.** §10 construit `settlement` / `settlement_line` (« moteur pur ; calcule le montant que l'agence rembourse ») et exige les tests dorés. Or BKG-028, BKG-032, BKG-035 sont MANUEL et la note de BKG-028 dit « l'ops annule et calcule le remboursement selon la politique affichée » ; PAY-021 (04) et 18 disent au contraire « montant calculé par la plateforme ». 04 est lui-même contradictoire, et **aucune des 76 lignes ne porte l'effort du moteur** (E9 : 1 ligne construite, 0 à 0,1 semaine-équipe). Le moteur de 08 (BR-CXL, E1 à E5, T01 à T68) est la pièce la plus lourde du dossier.
2. **`manual_action` à commandes réelles.** §10 dit que chacune des 21 actions de console appelle « une commande de domaine réelle (même transaction, même règlement) ». C'est transformer du MANUEL en construit. `RECORD_CLAIM` / `ISSUE_DECISION` n'ont d'ailleurs pas de commande réelle (les tables `claim`, `dispute` sont différées).
3. **« Non négociable » hors barème** : exclusion + conversion gardée + fuzz ≥ 10 000 exécutions avec horloge virtuelle, RLS + tests d'IDOR, crypto-shredding + chaîne de hachage, Money + tests dorés, Multi-AZ/KMS/S3. 04 attribue à BKG-014 et CAL-011 (« élevée ») 3 à 8 jours chacune, avec une note Bêta « hold de 10 min et contrainte d'exclusion ; expiration par tâche planifiée simple », qui ne correspond plus à la conception du §2.5 (AGENCY_LINK 120 min, conversion gardée, compensation).
4. §9 place conversion gardée, RLS et crypto-shredding en **lot 0**, dont le barème de 04 est 1,9 à 4 semaines-équipe pour la Bêta (socle réduit inclus).

**Réalisme pour 2 développeurs assistés par IA** (ordre de grandeur de l'auditeur, non mesuré, à recaler après le lot 1 comme le prévoit 18 §5.3) : surcoût hors barème ≈ conversion gardée + compensation + banc C1–C12 (+1,5 à 2), RLS + IDOR + séparation des rôles (+0,5 à 1), crypto-shredding + chaîne de hachage + DSR (+1 à 1,5), moteur de règlement + port des vecteurs dorés (+2 à 4), cadre `manual_action` (+1 à 2) : **≈ +6 à +10 semaines-équipe**, soit **≈ 14 à 24 semaines** pour la Bêta, contre 8 à 14 annoncées. La coupe est **structurellement cohérente** avec 04, mais l'énoncé « 8 à 14 semaines » n'est pas crédible avec la liste « non négociable » telle qu'écrite. Choix à faire : (i) ajouter dans 04 des lignes Bêta pour le moteur de règlement et la conversion gardée, et re-chiffrer ; ou (ii) réduire : moteur limité aux 3 cas d'annulation les plus fréquents avec calcul de l'ops contrôlé par le moteur en lecture seule, fuzz à 1 000 exécutions en CI et 10 000 de nuit, crypto-shredding limité au schéma (clé par sujet présente, outil de destruction au premier cas réel), `manual_action` sans commande réelle pour les actions rares.

### Constats MINEUR

- **M1 — Horloge.** Voir §2.8.
- **M2 — Sérialisation par véhicule.** Aucun verrou consultatif par véhicule ; `40P01` possible entre deux écritures concurrentes de l'index d'exclusion (ré-acquisition contre pose) ; la reprise du travailleur sur `40P01`/`40001` n'est pas spécifiée. Ordre global de verrouillage à écrire : guest → véhicule → ligne de hold. À mesurer dans C1.
- **M3 — Contrôles à la conversion.** La conversion ne revalide que montant, devise, compte PSP. Après une ré-acquisition (ou un `AGENCY_LINK` de 120 min) il faut revérifier : heure de début non écoulée (préavis `advance_notice_minutes`), annonce et véhicule toujours `LISTED` et non `RESTRICTED`, guest toujours éligible (BKG-012 : restriction posée entre-temps), devis non invalidé. Sinon un trip peut être créé après le début prévu ou sur un véhicule suspendu.
- **M4 — I-OCC d'un seul côté.** Le trigger différé est posé côté `trip` : un `UPDATE vehicle_occupancy SET active=false` direct sur une ligne `TRIP` d'un trip non terminal passe jusqu'à l'oracle de nuit. Ajouter le trigger côté occupation (UPDATE/DELETE de `kind='TRIP'`). Lors d'une ré-acquisition, remettre `deactivated_reason = NULL`.
- **M5 — Hold en vol non réinitialisé et rotation de holds.** Après un refus définitif, le hold reste `PAYMENT_IN_FLIGHT` jusqu'à `payment_in_flight_until` : le véhicule reste bloqué sans paiement possible. Un guest peut aussi libérer et recréer des holds en boucle ; limite par (guest, véhicule, heure) à ajouter à la limitation de débit.
- **M6 — Plan de test.** (i) §6.1 CI écrit « C1 à C11 » et « T01–T65 » alors que le plan va à C12 et que 08 va à T68 (§4.3 cite T66–T68) ; ADR-009 et R15 aussi. (ii) L'invariant (iii) de C11 « en moins de 20 min virtuelles » ne dit pas depuis quand. (iii) Ajouter C13 (N1), C14 (N2), C15 (N3 a/b : appel PSP lent, libération sans annulation d'ordre), C16 (`40P01` rejoué).
- **M7 — Mode (b) Bêta : preuve et invariants.** Le paiement n'est enregistré `SUCCEEDED` que sur webhook rattachable ou sur `agency_payment_confirmation` : l'oracle C12 (« 0 paiement SUCCEEDED sans trip ni compensation ») est vide pour un paiement jamais confirmé par l'agence, c'est-à-dire exactement le cas à risque pour le guest. Un webhook ne se rattache que si le lien est créé par la plateforme (`provider_reference`) : avec un lien « saisi par l'agence », seule la confirmation manuelle prouve. À documenter comme limite de la Bêta. De plus, §4.3 contrôle les invariants « avant chaque envoi de commande » ; en Bêta aucune commande n'existe : les mêmes plafonds doivent être contrôlés à la **création** de `refund_instance` et d'`agency_refund_task` (`AGENCY_MANUAL`). Enfin `COUNTER_AGENT` ne peut pas confirmer un paiement (`payment.confirm_agency`) : à 120 min de TTL, un propriétaire doit être joignable pour chaque réservation au comptoir (risque d'exploitation).
- **M8 — Change.** Les écritures de la paire sont équilibrées chacune dans sa devise (vérifié sur le tableau §3.5) et cohérentes avec 08 (`fx_difference`, ratio de la capture d'origine, T55). Reste : (i) remboursements et chargebacks partiels convertis au ratio **arrondi** (`roundHalfUp`, ex. 13 912,83 → 13 913 dans T55) : le résidu d'arrondi entre `fx_position[USD]` et `fx_position[PYG]` n'a pas de compte de destination (le test (2) ne vise que les captures) ; (ii) `fx_position` n'est jamais soldée : le versement d'un hôte en PYG à partir de fonds USD est une vraie conversion, non modélisée (acceptable car ADR-028 conditionne tout PSP cross-border, à rappeler dans les critères de P1) ; (iii) 08 n'est pas encore mis à jour (C08-10) : 08 dit « une devise par écriture », compatible, mais le plan de comptes de 08 ne contient ni `fx_position` ni `conversion_group_id`.
- **M9 — RLS, détails.** `current_setting('app.org_id')::uuid` **lève une erreur** si le paramètre est absent (le texte promet « aucune ligne ») : utiliser `current_setting('app.org_id', true)` et traiter la chaîne vide ; vues avec `security_invoker` ; ne jamais renvoyer au client le `DETAIL` d'une erreur `23P01` (il expose clé et période de la ligne en conflit d'un autre locataire) ; les tests d'IDOR décrits ne couvrent que agence contre agence : ajouter guest contre guest (le risque principal avec `public_ref` de 40 bits) et staff hors dossier.
- **M10 — Crypto-shredding, limites.** (i) `webhook_inbox.raw_body_enc` est persisté **avant** rattachement (§4.4 point 3 puis 6) : la clé du sujet est inconnue à l'écriture et la ligne est immuable ; chiffrer par compte PSP/organisation et réduire la rétention du corps brut. (ii) Les sauvegardes et la restauration à un instant donné contiennent `wrapped_dek` : après une restauration, la clé détruite revient ; tenir un registre d'effacement ré-appliqué après toute restauration (à tester dans ADM-035) et dire le délai effectif au demandeur. (iii) Chiffrer chaque ligne d'audit avec une clé de sujet couple l'écriture d'audit à la disponibilité de KMS : cache de clés et mode dégradé. (iv) `trip_identity_check.evidence_file_ids` peut contenir des images de pièce (C3) à l'échec du contrôle comptoir : contredit « zéro copie » sauf sous gel légal ; le classer et le borner.
- **M11 — Coupe Bêta, détails.** Chiffre « ≈ 60 tables » faux (voir N5) ; 56 lignes construites sans rattachement nominatif ; SRC-008 (carte avec marqueurs de prix) est construit alors que `GeoProvider` est différé : aucun port ni fournisseur de cartes listé ; `outbox_event`/`inbox_receipt`/`scheduled_job` à lister dans AUD ou CFG.
- **M12 — Biométrie, rétention.** Les durées (30 jours après décision, rétention fournisseur « la plus courte ») sont contractuelles chez le fournisseur : la plateforme ne peut pas les vérifier. Exiger dans le contrat de sous-traitance une attestation de suppression et un test d'effacement par la `data_subject_request` ; fixer la rétention des **scores** (C3) conservés chez nous (non écrite).
- **M13 — Priorité au payeur (décision produit).** Le texte fait perdre A (qui a payé) contre B (simple hold actif non payé). Option à instruire : à la ré-acquisition, un hold non payé et non en vol de B peut être libéré au profit de A (B notifié). Elle évite des remboursements de 5 jours ouvrés (Yappy, mode b). À trancher avec UXQ-09.
- **M14 — Spécification de 2a.** Le volet « puis : `h.guest_user_id = $guest` » n'est qu'un commentaire : écrire la seconde requête (ou une seule requête avec `OR` bornée) et son test C9.

---

## 4. Esquisse DDL PostgreSQL et transaction (non exécutée)

Objectif : montrer que l'exclusion à prédicat `WHERE (active)` se comporte comme décrit lors de la réactivation, et ajouter les correctifs M2/N1/N3. `btree_gist` est requis pour `uuid WITH =` (supporté depuis PostgreSQL 10).

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE vehicle_occupancy (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id         uuid        NOT NULL,
  kind               text        NOT NULL CHECK (kind IN ('TRIP','HOLD','HOST_BLOCK','BUFFER')),
  period             tstzrange   NOT NULL,                 -- [début, fin + tampon)
  active             boolean     NOT NULL DEFAULT true,
  expires_at         timestamptz,
  deactivated_reason text,
  ref_id             uuid,
  CONSTRAINT period_valid CHECK (NOT isempty(period) AND NOT lower_inf(period)
        AND NOT upper_inf(period) AND lower_inc(period) AND NOT upper_inc(period)),
  CONSTRAINT hold_has_ttl     CHECK (kind <> 'HOLD' OR expires_at IS NOT NULL),
  CONSTRAINT trip_has_no_ttl  CHECK (kind <> 'TRIP' OR expires_at IS NULL),
  CONSTRAINT vehicle_occupancy_no_overlap
    EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)   -- immédiate, non différable
);

CREATE TABLE checkout_hold (
  id uuid PRIMARY KEY, vehicle_id uuid NOT NULL, occupancy_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN
    ('ACTIVE','PAYMENT_IN_FLIGHT','CONVERTED','EXPIRED','RELEASED','COMPENSATED')),  -- COMPENSATED : ajout N1
  expires_at timestamptz NOT NULL, payment_in_flight_until timestamptz,
  converted_trip_id uuid,
  CHECK (status <> 'CONVERTED' OR converted_trip_id IS NOT NULL));

CREATE TABLE hold_compensation (
  id uuid PRIMARY KEY, hold_id uuid NOT NULL, operation_id uuid NOT NULL,
  reason text NOT NULL,                                   -- + 'DUPLICATE_PAYMENT' (N2)
  UNIQUE (hold_id, operation_id));
```

Conversion gardée (étape 4) avec les correctifs N1, N2 et M2 :

```sql
BEGIN;
-- M2 : sérialiser tous les écrivains d'occupation d'un véhicule (ordre : guest -> véhicule -> hold)
SELECT pg_advisory_xact_lock(hashtextextended('veh:' || :vehicle_id::text, 0));

SELECT status, occupancy_id FROM checkout_hold WHERE id = :hold FOR UPDATE;   -- pas de prédicat de statut
--  CONVERTED   -> si :operation = opération de conversion : renvoyer le trip ; sinon compensation DUPLICATE_PAYMENT (N2)
--  COMPENSATED -> journaliser et ignorer (N1)
--  ACTIVE / PAYMENT_IN_FLIGHT / EXPIRED / RELEASED -> suite

SAVEPOINT reacquire;
UPDATE vehicle_occupancy
   SET kind = 'TRIP', active = true, expires_at = NULL,
       deactivated_reason = NULL, ref_id = :trip
 WHERE id = :occupancy AND kind = 'HOLD';
-- 0 ligne        -> compensation + alerte P1
-- SQLSTATE 23P01 -> ROLLBACK TO SAVEPOINT reacquire ;
--                   INSERT hold_compensation(...) ; UPDATE checkout_hold SET status='COMPENSATED' ; COMMIT
-- SQLSTATE 40P01/40001 -> ROLLBACK complet puis rejeu de toute la conversion (idempotent)

-- succès : insertion du trip, du lien de paiement, de guest_occupancy ; SAVEPOINT séparé pour guest_no_overlap
UPDATE checkout_hold SET status = 'CONVERTED', converted_trip_id = :trip WHERE id = :hold;
COMMIT;   -- trigger différé I-OCC
```

Raisonnement vérifié (non exécuté) :
1. `UPDATE … SET active = true` sur une ligne dont `active` était `false` modifie une colonne du prédicat de l'index partiel : le moteur insère une nouvelle entrée d'index et **réévalue** l'exclusion (la mise à jour n'est pas « HOT »). Le texte du §2.5 (« l'écriture `active = true` fait réévaluer la contrainte ») est donc exact.
2. Sur une ligne déjà `active = true` (cas nominal), rien dans les colonnes de l'index ne change : pas de réévaluation, et c'est correct puisqu'aucune période ni véhicule ne change.
3. Les `CHECK` `hold_has_ttl` et `trip_has_no_ttl` portent sur la **nouvelle** ligne : le passage `HOLD → TRIP` doit remettre `expires_at` à `NULL` dans la même instruction, ce que fait l'`UPDATE`.
4. `CHECK (NOT isempty … )` rejette l'intervalle vide et non borné ; `NOT NULL` couvre le `NULL` que `CHECK` laisserait passer (F20 de VERIF_14 : corrigé).
5. Le `WHERE (active)` ne contient pas `now()` : conforme à l'exigence d'immuabilité du prédicat. L'expiration repose sur la mise à jour jointe de `status` et `active`.
6. La contrainte d'exclusion n'est **pas** différable : l'erreur `23P01` arrive à l'instruction, ce qui rend le `SAVEPOINT` du texte utilisable. Elle contourne la RLS (les contraintes ne sont pas soumises aux politiques) : indispensable pour que la limite inter-agences tienne, mais c'est aussi la raison de ne pas renvoyer le `DETAIL` au client (M9).
7. Le trigger différé I-OCC est un `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` `AFTER` : possible côté `trip` et côté `vehicle_occupancy` (M4).

À exécuter en CI sur PostgreSQL réel avant le lot 2 : C1 avec et sans verrou par véhicule (mesurer le p95 et compter les `40P01`), C2 à C5 avec barrières, et les tests C13 à C16 de M6.

---

## 5. Sécurité : vérification des changements

| Sujet | Constat | Verdict |
|---|---|---|
| RLS obligatoire (§2.3, §6.6, ADR-027) | `FORCE ROW LEVEL SECURITY`, rôle sans `BYPASSRLS`, rôle distinct pour les travailleurs, test de migration « table à `org_id` sans politique ⇒ échec » : bien. Manque : politiques guest/public/staff, invariants inter-agences, fonctions privilégiées, vues, comportement d'erreur (N4, M9) | Partiel (N4) |
| Tests inter-agences | « agence B sur identifiant de l'agence A ⇒ 404 » par route : bien ; guest contre guest et staff hors dossier absents (M9) | Partiel |
| Crypto-shredding (§3.1.3, ADR-026) | Chaîne de hachage sur chiffré, `before/after` en références, gel légal, verrou objet limité à `PRIVATE_EVIDENCE` : conforme à VERIF_14-F14. Limites : clé inconnue à l'écriture de `webhook_inbox`, restauration, couplage KMS (M10) | Corrigé avec réserves |
| Biométrie (§1.5.3, ADR-029) | Zéro copie d'image, scores C3, rétention la plus courte, sous-traitants avant collecte : conforme à VERIF_14-F15. Rétentions contractuelles invérifiables, scores non bornés, `evidence_file_ids` (M10, M12) | Corrigé avec réserves |
| Séparation des tâches, `kyc.read_sensitive`, `payment.confirm_agency` | Présents (§2.3) ; `COUNTER_AGENT` exclu de la confirmation : cohérent, avec la réserve opérationnelle de M7 | Conforme |

---

## 6. §4.3 contre 08 après VERIF_12

| 08 (E1, E2, E5) | §4.3 | Verdict |
|---|---|---|
| `collected_total` = Σ CAPTURE + MIT_CHARGE + CREDIT_REDEMPTION − CHARGEBACK perdus + REVERSAL ; crédits inclus (M3 de VERIF_11) | 4.3.1 : mêmes termes + `LINK_PAYMENT`, `DEBT_COLLECTION`, restreint aux `purpose` loyer (`RENT`, `RENT_SHORTFALL`, `NO_SHOW_RETENTION`) | Conforme, plus précis (C08-6 reporté) |
| `refund_committed` hors `CANCELLED`/`SUPERSEDED` ; `≤ collected_total` jusqu'au premier chargeback perdu ; ensuite excédent = `guest_receivable` (T53 : 187,44) | 4.3.2 : identique, avec contrôle de l'écart | Conforme |
| Imputation incrémentale `refundable[m] = max(0, payé[m] − refund_committed[m] − chargeback_perdu_net[m])` (T66) | 4.3.3 | Conforme |
| `refund_external ≤ collected_external` | 4.3.4 | Conforme |
| Après chargeback perdu : aucune capture ni MIT de `need` (VERIF_12-F2) | 4.3.5 | Conforme |
| `attempt_no` des encaissements (T68) | cité en tests dorés | Conforme |
| Plafonds d'origine caution, dommages, compensation de hold | 4.3.6 | Ajout cohérent |

Réserves : M7 (contrôle à la création des tâches d'agence en Bêta) ; M6 (T01 à T65 contre T01 à T68) ; N2 (un second paiement de loyer gonfle `collected_total`).

---

## 7. Corrections demandées, par priorité

1. N1 : état `COMPENSATED`, garde en 4.1, invariant XOR, test C13.
2. N2 : motif `DUPLICATE_PAYMENT`, une opération de loyer par hold, test C14.
3. N3 : `PAYMENT_IN_FLIGHT` avant l'appel PSP et conditionnel ; libération douce sans `SUPPORTS_ORDER_CANCEL` ; test C15.
4. N4 : politiques RLS par type d'acteur et fonctions `SECURITY DEFINER` minimales pour les invariants inter-agences.
5. N5 : trancher entre ajouter des lignes à 04 (moteur de règlement, conversion gardée) et réduire la liste « non négociable » ; corriger « ≈ 60 tables » ; rapprocher la note Bêta de BKG-014/CAL-011.
6. M1 à M14 : au fil de l'eau, M1, M2, M3 avant le lot 2.

Fichiers revus non modifiés. Rapport : `C:\Users\noamm\Documents\turo-audit-latam\research\turo-audit\verification\VERIF_16_ARCH_V2.md`.
