# ADR-092 — Cadre des actions de console (`manual_action`) : commande de domaine liée, aucun montant saisi, pièces, FINANCE à deux personnes

- **Statut** : PROPOSÉ (US-101, agent back-end, claude-opus-5-5, 2026-11-11 ; complété le même jour après les cinq revues de la PR #99 : MAJEUR de sécurité n° 1, d'argent n° 3, d'architecture n° 2, de QA n° 4 et n° 5). Revues exigées : code, **sécurité** (RLS, rôles, `SECURITY DEFINER`, SQL dynamique) et architecture (`packages/db/`), sur un autre modèle que l'auteur.
- **Sources** : 19 US-101 (critères d'acceptation) ; 17 §1.8 D7, §2.3 (matrice des permissions, commandes FINANCE à deux personnes, RLS-24), §3.2.13 (`manual_action`), §10 NN9 et « catalogue minimal des actions de console », NN3 (« l'ops ne saisit jamais le montant ») ; C-v3-05 ; ADR-062 (console, MFA du staff) ; ADR-056 point 4 et ADR-063 point 7 (un appel = une instruction) ; migrations 0034 (US-012) et 0036 (US-062).

## Contexte

US-012 a livré la commande `core.iam_staff_cmd_manual_action` : session élevée, permission, portée pays, journal, idempotence. Son catalogue ne comptait que trois actions. Une action d'état y était refusée (`UNAVAILABLE`), car aucune commande de domaine n'existait.

US-101 doit livrer le **cadre** demandé par 17 §10 NN9 : une action qui change un état appelle la **commande de domaine réelle** dans la même transaction, et une action rare est d'**enregistrement seul**, avec un motif et des pièces. Une décision FINANCE n'est qu'une demande tant qu'une seconde personne ne l'a pas validée.

Au lot 1, aucune commande de domaine d'état n'existe encore : les annulations viennent avec US-208, le KYC et la vérification d'hôte avec US-123, l'annonce avec US-124. Seules les commandes FINANCE à deux personnes d'US-062 (0036) existent. Le cadre doit donc permettre à chaque story d'**ajouter** sa commande sans réécrire la commande de console. Le lint expand / contract interdit en outre d'altérer une ligne existante du catalogue.

## Décision

1. **Catalogue minimal de 17 §10** (migration 0060). Il compte 19 actions :
   - 10 actions d'état, en `DOMAIN_COMMAND` ;
   - 6 actions d'enregistrement seul, en `RECORD_ONLY` ;
   - 3 actions FINANCE, en `DOMAIN_COMMAND`.

   `CREATE_HOST_ACCOUNT` est laissée à US-107. Chaque action déclare sa permission (17 §2.3), son type de sujet, ses **clés de saisie** (`input_keys`), l'**énumération fermée** des valeurs admises par clé (`input_values`) et si elle exige une **approbation** par une seconde personne (`requires_approval`, vrai pour les trois actions FINANCE). Un test L0 compare chaque action à un tableau tiré de 17 §2.3 et §10 (et de la table ci-dessous pour les valeurs PROPOSÉES), jamais au catalogue lui-même. Les types de sujet sont `TRIP`, `ORGANIZATION`, `IDENTITY_VERIFICATION`, `LISTING`, `SUPPORT_CASE`, `PLATFORM_ADVANCE` et `INSURER_BORDEREAU`. La contrainte de 0034 est remplacée sous le même nom, en l'élargissant.

   **PROPOSÉ, là où 17 ne nomme pas l'action** :

   | Action(s)                               | Permission                        |
   | --------------------------------------- | --------------------------------- |
   | `CANCEL_TRIP_GUEST`, `CANCEL_TRIP_HOST` | `ops.platform_cancel`             |
   | `REFUSE_AT_PICKUP`                      | `kyc.license_check_at_handover`   |
   | `REVIEW_FLAGGED_BOOKING`                | `kyc.decide`                      |
   | `ESCALATE_OVERDUE`                      | `ops.force_terminate_trip`        |
   | `ISSUE_DECISION`, `RECORD_CHARGEBACK`   | `dispute.decide`                  |
   | `RECORD_REVIEW`                         | `ops.review_listing_host`         |
   | `HANDLE_DSR`                            | `data.export` (ADMIN, SUPERADMIN) |

   `HANDLE_DSR` porte sur un `SUPPORT_CASE`, qui donne le pays. La matrice `iam_role_permission` reçoit les lignes OPS et ADMIN correspondantes. FINANCE ne reçoit pas `dispute.decide` : 17 le limite (« lim. (montants) »).

2. **Une seule commande de console, à pièces** : `core.iam_staff_cmd_manual_action(token, request_id, action, sujet, motif, input, pièces uuid[])`. Elle est `SECURITY DEFINER`, appartient à `iam_staff_owner`, et seul `app_api` a `EXECUTE`. Elle procède dans cet ordre :
   - session (preuve de possession) ;
   - forme des données ;
   - niveau TOTP ;
   - **pays du sujet relu en base**, par le résolveur DÉCLARÉ du type de sujet (§2 bis) ;
   - permission et portée pays : un refus est journalisé (`STAFF_FORBIDDEN`), et un sujet introuvable rend la même issue (aucun oracle d'existence) ;
   - règles de saisie et pièces ;
   - idempotence : même `request_id` ⇒ `DUPLICATE`, avec l'issue d'origine ; un `request_id` réutilisé pour une autre action est refusé. Deux appels **concurrents** du même `request_id` sont sérialisés par un verrou consultatif de transaction (`pg_advisory_xact_lock` sur une empreinte du `request_id`) : le second attend la fin du premier, puis rend `DUPLICATE` au lieu d'une violation d'unicité (preuve L0 sur deux connexions) ;
   - disponibilité ;
   - exécution, puis audit **en dernier** (passation US-009).

   Un type de sujet non déclaré (`IDENTITY_VERIFICATION`, `LISTING`, dont la table n'existe pas en Bêta) rend `UNAVAILABLE`, ou `FORBIDDEN` sans la permission. La forme d'US-012 (sans pièces) délègue à cette commande : elle garde les mêmes règles, et une action d'enregistrement seul y est donc refusée.

2 bis. **Types de sujet déclarés** (revue d'architecture n° 2). La table `core.support_manual_action_subject (subject_type, resolver regprocedure, story)`, écrite par migration seulement, déclare chaque type et son **résolveur de pays** : `(p_id uuid) RETURNS text`, `STABLE`, `search_path` figé, exécutable par `iam_staff_owner` et jamais par un rôle applicatif (déclencheur `manual_action_subject_guard`, contrôle `core.support_subject_resolver_check`, revérifié à chaque appel : un résolveur devenu non conforme rend le type inconnu). Cinq types sont déclarés (`TRIP`, `ORGANIZATION`, `SUPPORT_CASE`, `PLATFORM_ADVANCE`, `INSURER_BORDEREAU`). La story qui crée la table d'un type (US-123, US-124) **ajoute** sa ligne et son résolveur (INSERT) : il n'y a plus de fonction partagée à réécrire, donc plus de risque qu'une migration efface la branche d'une autre. Un test L0 vérifie que chaque type déclaré répond « connu » avec le pays de son sujet, et que seuls `IDENTITY_VERIFICATION` et `LISTING` restent non déclarés : quand leur table existera, ce test devra être mis à jour, avec la déclaration. L'appel du résolveur est un `EXECUTE` (nom lu dans `pg_proc`, valeur liée) : seconde dérogation `dynamic-sql`.

3. **Aucun montant saisi** (NN3 ; critère 1). `input` est un objet de 4 Kio au plus. Il n'admet que les clés déclarées par l'action, et pour chacune une valeur de l'**énumération fermée** du catalogue (`decision` ∈ {`APPROVED`, `REJECTED`}, PROPOSÉ). Une contrainte du catalogue (`manual_action_catalog_input_values_valid`) exige une énumération pour chaque clé, faite de mots (lettres et soulignés, jamais un chiffre) : aucune valeur numérique ne peut donc être admise. Tout le reste est refusé avec le code `22023` : clé non déclarée, nombre, objet, chaîne numérique, valeur hors énumération (la casse compte). Une autre contrainte du catalogue interdit toute clé qui nomme un montant (`amount`, `minor`, `montant`, `monto`, `valor`, `price`, `fee`, `total`, `refund`, `sum`). Les actions FINANCE et d'annulation n'admettent aucune clé : la commande de domaine calcule ou lit les montants. L'API applique la même règle de forme (400), et l'écran de la console n'a aucun champ de montant.
4. **Enregistrement seul** (critère 2) : le motif compte de 10 à 1000 caractères, et **au moins une pièce** est exigée (20 au plus, sans doublon). Chaque pièce doit être un `audit_file_asset` du seau `PRIVATE_EVIDENCE`, non supprimé. Aucun effet de domaine. La ligne `manual_action` (`outcome = RECORDED`, `evidence_file_ids`) est rattachée à sa ligne d'audit `MANUAL_ACTION_RECORDED`. La règle d'une pièce au moins est PROPOSÉE, fail-closed ; elle est inscrite dans `COMME_TURO.md` (une déclaration se fait avec ses preuves).
5. **Commande de domaine liée** (critère 1). La table `core.support_manual_action_handler (action_code, handler regprocedure, story)` est écrite **par migration seulement** (`migrator_all`). Le contrôle `core.support_manual_action_handler_check(action, gestionnaire)` rend `NULL` si la liaison est conforme, sinon le contrôle en échec :
   - `domaine` : l'action est en `DOMAIN_COMMAND` ;
   - `approbation` : une action `requires_approval` n'est liée qu'à la demande FINANCE (§6) ;
   - `retour`, `types`, `modes`, `colonnes` : la signature exacte `(p_token_hash bytea, p_action_id uuid, p_action_code text, p_subject_id uuid, p_input jsonb, p_reason text, p_actor uuid, p_actor_role text) RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])` ;
   - `search_path` figé ;
   - `SECURITY DEFINER` : le gestionnaire ne s'exécute jamais avec les droits larges d'`iam_staff_owner` ;
   - `propriétaire` : un rôle NOLOGIN, autre qu'`iam_staff_owner` ;
   - `EXECUTE` : accordé à `iam_staff_owner` et **jamais** à `PUBLIC`, `app_api`, `app_worker` ni `app_anon`. Le gestionnaire reçoit l'acteur en argument : exposé, il permettrait de le forger.

   Le contrôle est appelé **à la liaison** (déclencheur `manual_action_handler_guard`) et **à chaque appel** par la commande de console (revue sécurité n° 1). Une liaison devenue non conforme après coup, par exemple un `GRANT EXECUTE … TO app_api` ultérieur, rend l'action `UNAVAILABLE`, journalisé avec le contrôle en échec, et le gestionnaire n'est pas appelé. Un test L0 réapplique le contrôle à **toutes** les liaisons en base, prouve qu'il trouve une liaison exposée après coup, et joue chacun des contrôles par un gestionnaire non conforme.

   La commande de console appelle le gestionnaire **dans la même instruction**, par un `EXECUTE` : le nom est lu dans `pg_proc` par l'OID lié et cité par `format('%I.%I')`, et toutes les valeurs passent par `USING`. Aucun texte du client n'entre dans l'appel. C'est une dérogation `dynamic-sql`, inscrite dans `expand-contract-allowlist.json`.

   Issues du gestionnaire :
   - `DONE` ou `REQUESTED` : ligne `manual_action` (issue, référence, événements émis), puis audit `MANUAL_ACTION_DONE` ou `MANUAL_ACTION_REQUESTED` ;
   - toute autre issue : `REFUSED`, journalisé (`MANUAL_ACTION_REFUSED`, avec l'issue du domaine), sans ligne ;
   - une erreur annule tout : effet, ligne et audit.

   Une action d'état sans commande liée rend `UNAVAILABLE`, journalisé : aucun changement d'état n'est imité. Une story qui livre sa commande **ajoute** une ligne de liaison (INSERT) ; elle ne réécrit pas ce cadre. La preuve L0 utilise une commande sonde de test, liée par la vraie table.

6. **FINANCE à deux personnes** (critère 3, RLS-24). `ISSUE_BORDEREAU`, `DECIDE_ADVANCE` et `WRITE_OFF_RECEIVABLE` portent `requires_approval` et sont liées à `core.support_manual_action_finance_request` (`SECURITY DEFINER`, propriétaire `cmd_money_owner`, `EXECUTE` au seul `iam_staff_owner`), qui appelle `settlement_cmd_request_finance_action` (0036, inchangée). La garantie est **dans le cadre**, pas seulement dans la donnée de liaison (revue argent n° 3) : une action `requires_approval` ne peut être liée qu'à cette demande, et une issue `DONE` y est refusée (exception, tout est annulé). L'action n'est qu'une **demande** (`REQUESTED`, référence = la demande `finance_approval`). L'effet n'a lieu qu'à `cmd_approve_finance_action` par une **seconde personne distincte** : le demandeur est refusé, même dans une autre session (`SELF_APPROVAL`). La demande relit d'elle-même la session, le contexte STAFF, la permission, la portée et l'éligibilité, et journalise ses refus.
7. **Contexte STAFF posé par l'API dans l'instruction.** `PgManualActionStore` et l'approbation utilisent une CTE matérialisée qui pose les sept paramètres `app.*`, puis appellent la commande en `LATERAL` sur une colonne de la CTE. Le contexte est donc posé avant l'appel, en autocommit (ADR-056 point 4). La portée pays posée est celle des rôles de la session. Elle ne fait que réduire : la base relit les rôles. La liste des demandes en attente est lue sous la RLS `fin_read` (FINANCE et ADMIN du pays, colonnes sans identifiant du personnel), dans une transaction courte de lecture.
8. **RLS par rôle staff** :
   - `manual_action`, le catalogue et les liaisons restent illisibles et non modifiables par tout rôle applicatif (`42501`) ;
   - `iam_staff_owner` lit seulement `id` et `country_code` des sujets (`iam_organization`, `settlement_platform_advance`, `settlement_insurer_bordereau`) et `id`, `bucket` et `deleted_at` des pièces ;
   - la lecture humaine passe par le journal (`iam_staff_audit_read`, `audit.read` : ADMIN dans sa portée, OPS et FINANCE leurs propres lignes) et par les demandes FINANCE (`fin_read`).
9. **API et console** :
   - `POST /console/actions` admet `evidence` et rend 201 `STAFF_ACTION_RECORDED`, `STAFF_ACTION_DONE` ou `STAFF_ACTION_REQUESTED` (avec `approvalId`), 409 `STAFF_ACTION_UNAVAILABLE` ou `STAFF_ACTION_REFUSED` (`values.reason`) ;
   - `GET /console/finance/approvals` et `POST /console/finance/approvals/{id}/approve` : 200, 409 `STAFF_SELF_APPROVAL` ou `STAFF_ACTION_REFUSED` ;
   - codes PROPOSÉS, à reporter dans 16 A.8 ;
   - écrans en es, en, fr et pt-BR (catalogue v11) : actions groupées comme 19 US-101, pièces, demandes FINANCE à approuver.

## Lien avec RC-5 (suite S-02, US-223)

ADR-088 laisse `MANUAL_OPS` terminal `UNPROVEN` : aucune action du staff journalisée ne prouve encore un statut de paiement. Ce cadre en est la fondation. US-223 ajoutera une action de catalogue (par exemple la constatation d'un statut vu dans le portail du PSP), et sa commande de domaine (paiement) liée par `support_manual_action_handler`. L'action sera journalisée, motivée et accompagnée de pièces, sans montant saisi. Si US-223 exige deux personnes, elle réutilise le patron demande / approbation de §6, en élargissant `finance_approval.action` par une demande de fusion revue. **US-223 n'est pas implémentée ici.**

## Conséquences

- Chaque story qui livre une commande d'état n'a qu'à livrer son gestionnaire (signature ci-dessus, `SECURITY DEFINER`, propriétaire NOLOGIN, `EXECUTE` à `iam_staff_owner` seulement) et une ligne de liaison. Si son type de sujet est nouveau, elle déclare ce type et son résolveur (une ligne). Elle met à jour le tableau du test de catalogue si 17 §2.3 change.
- **Approbation FINANCE aveugle** (revue argent n° 4, acceptée) : l'approbateur ne voit ni le montant ni la devise, et l'approbation n'est pas liée au montant vu par le demandeur. La correction demande un changement de 17 (empreinte du montant figée dans `finance_approval`) : suite inscrite dans `docs/team/BOARD.md` et demande de révision dans `docs/team/QUESTIONS.md`, **non implémentée ici**.
- Le téléversement des pièces par le staff n'existe pas encore : la console reçoit des identifiants de fichiers déjà reçus. Le stockage objet réel vient avec US-003 ; l'écran de téléversement est à confier à une story (US-109 ou suivante).
- `internal_note` et l'écriture de `support_case` (17 §2.3) ne sont pas créées : aucun critère d'US-101 ne les exige. Elles sont reportées à US-109 (fiche 360°, files).
- `available` du catalogue n'a plus de sens pour une action `DOMAIN_COMMAND`, où la liaison fait foi. La colonne est gardée (expand / contract).

## Écartés

- **Répartiteur statique** (`CASE action WHEN …` ou `IF type = …`) réécrit par chaque story : réécrire une fonction partagée à chaque lot crée des conflits entre stories parallèles, et une migration écrite à partir d'une version ancienne efface la branche d'une autre sans conflit de texte. Il est refusé, pour les commandes comme pour les types de sujet, au profit de tables de déclaration contrôlées.
- **`UPDATE` du catalogue pour lier une commande** : c'est une contraction (`data-update`) à chaque story ; la liaison par INSERT est en extension seule.
- **Montant admis puis comparé au moteur** : NN3 interdit que l'ops saisisse le montant ; aucun montant n'entre.
